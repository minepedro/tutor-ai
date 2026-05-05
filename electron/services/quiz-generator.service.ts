import { getSource, updateSourceProcessing } from '../database/repositories/sources.repo';
import { analyzeMaterial, type AnalysisResult } from './prompts/quiz-analysis';
import {
  generateQuestions,
  type GeneratedQuestion,
  type GenerationParams,
  type QuizQuestionTypePref,
} from './prompts/quiz-generation';
import { validateQuestions, type ValidationVerdict } from './prompts/quiz-validation';
import { suggestThemesFromText } from './prompts/theme-suggester';

/*
  Orquestrador do pipeline de 3 etapas:
    1. Análise (extrai conceitos do material — cacheado em sources.extracted_concepts)
    2. Geração (cria N perguntas a partir dos conceitos)
    3. Validação (filtra ambíguas/triviais/duplicadas/etc)

  O cache da etapa 1 é a otimização principal: gerar 5 quizzes do mesmo material
  vai usar a análise calculada uma vez. Cada análise custa ~1k tokens de input
  e ~2k de output → economia real.
*/

export type ProgressCallback = (pct: number, status: string) => void;

export interface GenerateQuizInput {
  /** IDs das sources a usar como material. Pelo menos 1. */
  sourceIds: string[];
  /** 3 a 30 perguntas. Validado aqui. */
  count: number;
  /** Tipo de pergunta (mc/tf/mixed). */
  types: QuizQuestionTypePref;
  /** Filtro opcional de tema livre. */
  themeFilter?: string;
}

export interface GeneratedQuiz {
  questions: GeneratedQuestion[];
  /**
   * `false` se o filtro de tema foi passado mas nenhuma pergunta foi gerada
   * (geralmente porque o tema não está no material). UI mostra mensagem.
   */
  themeMatched: boolean;
  /** Quantas perguntas foram geradas antes da validação. */
  totalGenerated: number;
  /** Quantas sobreviveram à validação. */
  totalValidated: number;
  /** Verdicts da validação na mesma ordem de `totalGenerated`. */
  verdicts: ValidationVerdict[];
  /** Lista deduplicada de temas sugeridos (para UI mostrar como chips). */
  suggestedThemes: string[];
}

export async function generateQuiz(
  input: GenerateQuizInput,
  onProgress: ProgressCallback,
): Promise<GeneratedQuiz> {
  validateInput(input);

  // ── Etapa 0: pré-validação dos sources ─────────────────────────────────
  const sources = input.sourceIds.map((id) => {
    const s = getSource(id);
    if (!s) throw new Error(`Source ${id} não encontrada`);
    if (s.rawText === null) {
      throw new Error(
        `Source "${s.filename}" ainda não foi processada. Aguarde a ingestão.`,
      );
    }
    return s;
  });

  // ── Etapa 1: análise (com cache, tolerante a falha por source) ─────────
  onProgress(5, 'Analisando material…');

  /*
    Robustez: se 1 source falhar (Claude retorna JSON inválido, etc),
    seguimos com as outras. Só lançamos erro se TODAS falharem. PDFs
    bagunçados às vezes geram respostas estranhas; esse design evita
    abortar tudo por causa de 1 arquivo problemático.
  */
  const analyses: AnalysisResult[] = [];
  const sourceErrors: Array<{ filename: string; error: string }> = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;

    try {
      let analysis: AnalysisResult;
      if (source.extractedConcepts) {
        try {
          analysis = JSON.parse(source.extractedConcepts) as AnalysisResult;
          onProgress(
            5 + Math.round(((i + 1) / sources.length) * 25),
            `Material ${i + 1}/${sources.length}: usando análise já feita…`,
          );
        } catch {
          // Cache corrompido — re-analisa.
          analysis = await analyzeAndCache(source.id, source.rawText!, (pct, status) => {
            const slice = 5 + Math.round((i / sources.length) * 25);
            onProgress(slice + Math.round((pct / 100) * (25 / sources.length)), status);
          });
        }
      } else {
        analysis = await analyzeAndCache(source.id, source.rawText!, (pct, status) => {
          const slice = 5 + Math.round((i / sources.length) * 25);
          onProgress(slice + Math.round((pct / 100) * (25 / sources.length)), status);
        });
      }
      analyses.push(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[quiz-generator] análise falhou pra ${source.filename}:`, err);
      sourceErrors.push({ filename: source.filename, error: message });
    }
  }

  if (analyses.length === 0) {
    const detail = sourceErrors
      .map((e) => `• ${e.filename}: ${e.error}`)
      .join('\n');
    throw new Error(
      `Nenhum material pôde ser analisado. Erros:\n${detail}\n\n` +
        'Tente com um PDF de texto puro (não escaneado) e tente novamente.',
    );
  }

  // Agrega conceitos de todas as sources, deduplicando por nome.
  const conceptsByName = new Map<string, (typeof analyses)[number]['concepts'][number]>();
  for (const a of analyses) {
    for (const c of a.concepts) {
      const key = c.name.toLowerCase().trim();
      if (!conceptsByName.has(key)) conceptsByName.set(key, c);
    }
  }
  const allConcepts = Array.from(conceptsByName.values());

  // Agrega temas sugeridos, deduplicando.
  const themes = new Set<string>();
  for (const a of analyses) {
    a.suggestedThemes.forEach((t) => themes.add(t.trim()));
  }

  if (allConcepts.length === 0) {
    throw new Error('Nenhum conceito foi extraído do material. PDF pode estar com texto ilegível.');
  }

  // ── Etapa 2: geração ───────────────────────────────────────────────────
  onProgress(35, `Gerando ${input.count} perguntas…`);

  const generationParams: GenerationParams = {
    concepts: allConcepts,
    count: input.count,
    types: input.types,
    ...(input.themeFilter ? { themeFilter: input.themeFilter } : {}),
  };
  const generated = await generateQuestions(generationParams);

  // Tema não casou com material: o modelo retorna array vazio.
  if (generated.length === 0 && input.themeFilter) {
    return {
      questions: [],
      themeMatched: false,
      totalGenerated: 0,
      totalValidated: 0,
      verdicts: [],
      suggestedThemes: Array.from(themes),
    };
  }

  if (generated.length === 0) {
    throw new Error('Modelo não conseguiu gerar perguntas a partir desse material.');
  }

  // ── Etapa 3: validação ─────────────────────────────────────────────────
  onProgress(75, 'Validando qualidade das perguntas…');

  const verdicts = await validateQuestions(generated);
  const validQuestions = generated.filter((_, i) => verdicts[i]?.valid !== false);

  onProgress(
    100,
    `${validQuestions.length}/${generated.length} perguntas aprovadas`,
  );

  return {
    questions: validQuestions,
    themeMatched: true,
    totalGenerated: generated.length,
    totalValidated: validQuestions.length,
    verdicts,
    suggestedThemes: Array.from(themes),
  };
}

/**
 * Sugere temas baseado no material das sources, sem gerar quiz.
 * Usado pelo botão "Sugerir temas" no QuizSetup.
 *
 * v0.7.4: refatorado pra ser RÁPIDO (~1-3s vs 30-90s antes):
 * - Source com cache `extracted_concepts` → instantâneo (lê JSON local)
 * - Source sem cache → roda prompt LEVE (`suggestThemesFromText`) que pede
 *   só temas (~150 tokens out, 15k chars in) em vez da análise completa
 *   (~3k tokens out, 50k chars in).
 * - Sources rodam em PARALELO via `Promise.all`.
 *
 * O cache de análise completa só é populado quando o aluno clica em
 * "Gerar quiz" (o pipeline real ainda roda `analyzeMaterial`). Isso evita
 * desperdiçar tokens em sources que o aluno só "espiou" sem gerar quiz.
 */
export async function suggestThemes(sourceIds: string[]): Promise<string[]> {
  const themesArrays = await Promise.all(
    sourceIds.map(async (id) => {
      const source = getSource(id);
      if (!source || source.rawText === null) return [];

      // Caminho 1: cache existe — instantâneo
      if (source.extractedConcepts) {
        try {
          const cached = JSON.parse(source.extractedConcepts) as AnalysisResult;
          return cached.suggestedThemes.map((t) => t.trim());
        } catch {
          // Cache corrompido — cai pro caminho leve
        }
      }

      // Caminho 2: prompt leve dedicado (sem cachear)
      return suggestThemesFromText(source.rawText);
    }),
  );

  // Dedupe case-insensitive preservando ordem da 1ª aparição
  const seen = new Set<string>();
  const result: string[] = [];
  for (const arr of themesArrays) {
    for (const t of arr) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(t);
    }
  }
  return result;
}

// ── Helpers internos ──────────────────────────────────────────────────────

async function analyzeAndCache(
  sourceId: string,
  rawText: string,
  onProgress: ProgressCallback,
): Promise<AnalysisResult> {
  onProgress(0, 'Lendo material e extraindo conceitos…');
  const result = await analyzeMaterial(rawText);
  // Cacheia em sources.extracted_concepts pra próximas gerações pularem essa etapa.
  updateSourceProcessing(sourceId, {
    extractedConcepts: JSON.stringify(result),
  });
  onProgress(100, 'Análise concluída.');
  return result;
}

function validateInput(input: GenerateQuizInput): void {
  if (!Array.isArray(input.sourceIds) || input.sourceIds.length === 0) {
    throw new Error('Pelo menos 1 source é obrigatório');
  }
  if (!Number.isInteger(input.count) || input.count < 3 || input.count > 30) {
    throw new Error('count deve ser inteiro entre 3 e 30');
  }
  if (
    input.types !== 'multiple_choice' &&
    input.types !== 'true_false' &&
    input.types !== 'mixed'
  ) {
    throw new Error('types inválido');
  }
}
