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
import { clusterConcepts, type ConceptCluster } from './clustering.service';

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
    seguimos com as outras. Só lançamos erro se TODAS falharem.

    v0.8.4: análise PARALELA via Promise.all. Sources com cache
    `extractedConcepts` resolvem instantâneo (sem chamada API); só as
    sem-cache disparam análise nova. Pra 5 sources sem cache:
    - Antes (sequencial): 5×~15s = ~75s
    - Agora (paralelo):    ~15s (limitado pela mais lenta)
    Cuidado com rate limit 429 — Anthropic permite ~50 req/min no tier
    inicial, bem acima do que disparamos aqui (5-10 reqs em paralelo).
  */
  const sourceErrors: Array<{ filename: string; error: string }> = [];
  let completedCount = 0;
  let cacheHits = 0;

  /*
    v0.8.6: progress granular DURANTE a análise paralela. Cada source que
    completa (cache hit OU análise nova) incrementa o contador e reporta
    pct proporcional entre 5% e 28%. Resolve o problema de "barra travada
    em 28% por minutos" quando há muitos PDFs sem cache (etapa 1 longa).

    Promise.all dispara N em paralelo; o `then` de cada uma chama
    onProgress assim que aquela source termina. Updates chegam fora de
    ordem mas são monotonicamente crescentes — frontend trata via
    Math.max em useSmoothProgress.
  */
  const settled = await Promise.all(
    sources.map(async (source): Promise<AnalysisResult | null> => {
      try {
        let result: AnalysisResult;
        if (source.extractedConcepts) {
          try {
            result = JSON.parse(source.extractedConcepts) as AnalysisResult;
            cacheHits++;
          } catch {
            // Cache corrompido → re-analisa
            result = await analyzeAndCache(source.id, source.rawText!, () => {});
          }
        } else {
          result = await analyzeAndCache(source.id, source.rawText!, () => {});
        }
        completedCount++;
        // Mapeia [5%, 28%] proporcionalmente conforme sources completam
        const pct = 5 + Math.round((completedCount / sources.length) * 23);
        onProgress(
          pct,
          `Analisando materiais (${completedCount}/${sources.length})…`,
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[quiz-generator] análise falhou pra ${source.filename}:`, err);
        sourceErrors.push({ filename: source.filename, error: message });
        completedCount++;
        const pct = 5 + Math.round((completedCount / sources.length) * 23);
        onProgress(pct, `Analisando materiais (${completedCount}/${sources.length})…`);
        return null;
      }
    }),
  );

  const analyses = settled.filter((a): a is AnalysisResult => a !== null);

  // Checkpoint final da etapa 1 (sempre, independente de cache).
  onProgress(
    30,
    cacheHits === sources.length
      ? `Análise: ${sources.length} ${sources.length === 1 ? 'material' : 'materiais'} (cache)`
      : `Análise concluída (${analyses.length}/${sources.length}).`,
  );

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

  // ── Etapa 1.5: clustering semântico (v0.9.0+) ──────────────────────────
  /*
    Agrupa conceitos por similaridade semântica via K-means sobre embeddings.
    Cada cluster vira um "tema" implícito; etapa 2 distribui perguntas com
    quota fixa por cluster, garantindo cobertura uniforme.

    Pattern de produção SOTA (47billion blog): cluster + quota > flat list.
    Reusa embedding.service ONNX local (gratuito; ~100ms pra 200 conceitos).
  */
  onProgress(33, `Agrupando ${allConcepts.length} conceitos em temas…`);
  const clusters = await clusterConcepts(allConcepts);
  // Shuffle pra evitar bias de ordem (modelo tende a focar nos primeiros)
  shuffleInPlace(clusters);

  // ── Etapa 2: geração ───────────────────────────────────────────────────
  onProgress(
    35,
    `Gerando ${input.count} perguntas em ${clusters.length} ${clusters.length === 1 ? 'tema' : 'temas'}…`,
  );

  const generationParams: GenerationParams = {
    clusters,
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

/*
  Cache in-memory dos temas leves por source. Sobrevive durante a sessão do
  app — clicar "Sugerir temas" 2x na mesma source = ZERO tokens da 2ª vez.
  Limpado quando source é re-ingerida ou deletada.

  Nota: este cache existe APENAS pro caminho leve (suggestThemesFromText).
  O caminho do `extracted_concepts` (banco) tem prioridade e cobre o caso
  "aluno já gerou quiz dessa source antes".
*/
const lightThemeCache = new Map<string, string[]>();

/**
 * Limpa o cache de temas leves. Chamar quando uma source é deletada ou
 * re-ingerida (rawText mudou → temas potencialmente diferentes).
 *
 * Sem argumento: limpa tudo. Com sourceId: limpa só essa.
 */
export function clearThemeCache(sourceId?: string): void {
  if (sourceId) lightThemeCache.delete(sourceId);
  else lightThemeCache.clear();
}

/**
 * Sugere temas baseado no material das sources, sem gerar quiz.
 * Usado pelo botão "Sugerir temas" no QuizSetup.
 *
 * Caminhos (em ordem de preferência, todos paralelos via Promise.all):
 *   1. Cache `extracted_concepts` no banco (source já foi usada em quiz)
 *      → instantâneo, ZERO tokens
 *   2. Cache in-memory de tema leve (resultado de "Sugerir temas" anterior
 *      nessa sessão) → instantâneo, ZERO tokens (v0.7.5+)
 *   3. Prompt leve `suggestThemesFromText` → ~1-3s, gasta tokens.
 *      Resultado vai pro cache in-memory (próxima chamada será grátis).
 */
export async function suggestThemes(sourceIds: string[]): Promise<string[]> {
  const themesArrays = await Promise.all(
    sourceIds.map(async (id) => {
      const source = getSource(id);
      if (!source || source.rawText === null) return [];

      // Caminho 1: cache no banco
      if (source.extractedConcepts) {
        try {
          const cached = JSON.parse(source.extractedConcepts) as AnalysisResult;
          return cached.suggestedThemes.map((t) => t.trim());
        } catch {
          // Cache corrompido — cai pro próximo
        }
      }

      // Caminho 2: cache in-memory desta sessão (v0.7.5+)
      const inMemory = lightThemeCache.get(id);
      if (inMemory) return inMemory;

      // Caminho 3: roda prompt leve e cacheia em memória
      const themes = await suggestThemesFromText(source.rawText);
      lightThemeCache.set(id, themes);
      return themes;
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

/**
 * Fisher-Yates shuffle in place. Usado pra randomizar a ordem dos clusters
 * antes de mandar pro modelo — evita bias de ordem (modelo tende a focar
 * nos primeiros itens da lista).
 */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
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
