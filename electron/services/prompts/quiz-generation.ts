import { complete } from '../claude.service';
import { parseLooseJson, parseLooseJsonArrayPartial } from '../../utils/json-parse';
import type { ExtractedConcept } from './quiz-analysis';
import type { ConceptCluster } from '../clustering.service';

/*
  Etapa 2 do pipeline: geração de perguntas.

  Recebe a estrutura de conceitos da etapa 1 + parâmetros do usuário, e cria
  perguntas calibradas. As regras no system prompt focam em qualidade
  pedagógica:
  - Testar compreensão, não memorização
  - Distratores plausíveis (alternativas erradas que parecem certas pra
    quem não estudou — não óbvias)
  - Mistura de dificuldades
  - Cada pergunta tem explicação detalhada da resposta correta
*/

export type QuizQuestionType = 'multiple_choice' | 'true_false';
export type QuizQuestionTypePref = QuizQuestionType | 'mixed';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';

export interface GeneratedQuestion {
  type: QuizQuestionType;
  difficulty: QuestionDifficulty;
  question: string;
  options: string[];
  /** Index 0-based da opção correta. */
  correctIndex: number;
  /** Explicação detalhada da resposta correta (mostrada após responder). */
  explanation: string;
  /** Nomes dos conceitos que essa pergunta testa. */
  conceptsRef?: string[];
}

export interface GenerationParams {
  /** Clusters de conceitos (v0.9.0+). Cada cluster vira um "tema" implícito;
      o modelo distribui perguntas com quota fixa por cluster. */
  clusters: ConceptCluster[];
  /** 3 a 30. */
  count: number;
  /** Tipo de pergunta desejado. */
  types: QuizQuestionTypePref;
  /**
   * Filtro opcional: usuário escreveu um tema específico. Se fornecido,
   * só geramos perguntas que envolvam esse tema. Pode ser texto livre tipo
   * "perguntas sobre derivadas" ou "capacidade produtiva".
   */
  themeFilter?: string;
}

/*
  System prompt v0.9.0+:
  - Recebe conceitos AGRUPADOS POR TEMA (cluster semântico)
  - Instrui distribuição uniforme: quota fixa por tema
  - Distratores melhorados via técnica de papers acadêmicos
    (arXiv 2404.02124 / arXiv 2307.16338 — +8% qualidade aprovada por
    professores): pedimos misconceptions plausíveis, não só "erros"
*/
const SYSTEM_PROMPT = `Você é um professor que cria quizzes de alta qualidade. Recebe conceitos AGRUPADOS POR TEMA (clusters semânticos) e gera perguntas que testam compreensão real.

REGRAS DE COBERTURA (v0.9.0+):
- O usuário verá perguntas de TODOS os temas. Distribua perguntas UNIFORMEMENTE entre os temas listados (ex: 8 perguntas, 4 temas → 2 perguntas por tema).
- Se a divisão não for exata, distribua o resto entre temas de maior importância pedagógica.
- Não concentre perguntas em 1 ou 2 temas só porque tem mais conceitos lá. Cobertura > profundidade num tema só.

REGRAS DE QUALIDADE:
- TESTAR COMPREENSÃO, não memorização. Evite perguntas tipo "qual a definição de X?".
- DISTRATORES = MISCONCEPTIONS PLAUSÍVEIS. Cada alternativa errada deve representar um ERRO COMUM que aluno mal-preparado cometeria. Pense: "que confusão alguém faria com esse conceito?". Distratores absurdos são banidos — eles não testam nada.
- Misture dificuldades por TEMA: idealmente 1 easy + 1 medium por tema; hard pra temas com múltiplos conceitos relacionáveis.
- "easy" = aplica direto a definição. "medium" = compara conceitos ou aplica em caso novo. "hard" = sintetiza múltiplos conceitos ou caso complexo.
- Cada pergunta tem UMA resposta correta inequívoca.
- Explicação detalhada (3-5 frases): por que a correta é certa E por que CADA distrator está errado (revela a misconception específica).
- Idioma: igual ao dos conceitos (geralmente português).

FORMATO DE SAÍDA: APENAS um array JSON, sem texto antes/depois, sem markdown. Schema:

[
  {
    "type": "multiple_choice" | "true_false",
    "difficulty": "easy" | "medium" | "hard",
    "question": "string — enunciado claro",
    "options": ["string", "string", "string", "string"],  // 4 alternativas pra MC, 2 pra TF (sempre ["Verdadeiro","Falso"])
    "correct_index": 0 | 1 | 2 | 3,  // index 0-based da correta
    "explanation": "string — 3-5 frases explicando incluindo POR QUE cada distrator está errado",
    "concepts_ref": ["nome do conceito"],  // opcional, conceitos testados
    "cluster_id": "string"  // ID do cluster de origem (ex: "c0", "c1") — ajuda debug
  }
]`;

interface RawGeneratedQuestion {
  type?: unknown;
  difficulty?: unknown;
  question?: unknown;
  options?: unknown;
  correct_index?: unknown;
  explanation?: unknown;
  concepts_ref?: unknown;
}

export async function generateQuestions(
  params: GenerationParams,
): Promise<GeneratedQuestion[]> {
  const userPrompt = buildUserPrompt(params);

  /*
    💡 Tokens necessários: empíricamente, perguntas em PT com explicações
    detalhadas usam ~500-700 tokens cada. Vou de 700 × count + 2000 de margem
    (cobre temas complexos com explicações longas). Sonnet 4.6 aceita até
    8192 tokens de output, então pra ≤ 8 perguntas cabe; pra 9+ pode estourar.
    Se estourar, o parser tolerante recupera as perguntas completas geradas
    até o ponto do corte (logamos warning).
  */
  const maxTokens = Math.min(700 * params.count + 2000, 8192);

  const response = await complete({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.7,
    maxTokens,
  });

  let parsed: RawGeneratedQuestion[] | null = null;

  // Tenta parse normal primeiro.
  try {
    const candidate = parseLooseJson<RawGeneratedQuestion[]>(response.content);
    if (Array.isArray(candidate)) parsed = candidate;
  } catch {
    // Falha — vai pra fallback abaixo.
  }

  /*
    Fallback pra resposta truncada: se a chamada bateu em max_tokens OU se o
    parse normal falhou, tenta extrair os objetos completos manualmente.
    Pode salvar a maioria das perguntas mesmo se a última estourou.
  */
  if (!parsed || response.stopReason === 'max_tokens') {
    const recovered = parseLooseJsonArrayPartial<RawGeneratedQuestion>(response.content);
    if (recovered.length > 0) {
      console.warn(
        `[quiz-generation] resposta truncada — recuperadas ${recovered.length}/${params.count} perguntas via parser parcial.`,
      );
      parsed = recovered;
    }
  }

  if (!parsed) {
    console.error(
      '[quiz-generation] resposta do modelo não é JSON válido. Início:\n',
      response.content.slice(0, 1500),
    );
    throw new Error(
      'O modelo retornou uma resposta inválida ao gerar perguntas. Tente novamente, ' +
        'ou peça menos perguntas se o problema persistir.',
    );
  }

  /*
    Validação por pergunta também é tolerante: se uma pergunta específica está
    malformada (ex: faltando campo, options de tamanho errado), pula ela em
    vez de abortar tudo.
  */
  const validated: GeneratedQuestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    try {
      validated.push(validateQuestion(parsed[i]!, i));
    } catch (err) {
      console.warn(
        `[quiz-generation] pergunta [${i}] descartada (malformada):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return validated;
}

function buildUserPrompt(params: GenerationParams): string {
  /*
    v0.9.0+: conceitos vêm AGRUPADOS POR TEMA (cluster semântico). Cada cluster
    vira um bloco rotulado [TEMA N — id]. O prompt instrui o modelo a
    distribuir perguntas uniformemente entre os blocos.

    Quota por cluster pré-calculada no orquestrador é uma sugestão visual,
    mas o modelo pode ajustar levemente baseado em complexidade dos conceitos.
  */
  const nClusters = params.clusters.length;
  const baseQuotaPerCluster = Math.floor(params.count / nClusters);
  const remainder = params.count - baseQuotaPerCluster * nClusters;

  const clustersText = params.clusters
    .map((cluster, idx) => {
      const themeNum = idx + 1;
      // Os primeiros `remainder` clusters ganham 1 pergunta extra pra fechar count
      const quota = baseQuotaPerCluster + (idx < remainder ? 1 : 0);
      const conceptsText = cluster.concepts
        .map((c) => {
          const related = c.related?.length
            ? ` (relacionado a: ${c.related.join(', ')})`
            : '';
          return `  - ${c.name} [${c.importance}]: ${c.definition}${related}`;
        })
        .join('\n');
      return `[TEMA ${themeNum} — ${cluster.id}] ~${quota} ${quota === 1 ? 'pergunta' : 'perguntas'}\n${conceptsText}`;
    })
    .join('\n\n');

  const typeInstruction = (() => {
    switch (params.types) {
      case 'multiple_choice':
        return 'Apenas múltipla escolha (4 alternativas cada).';
      case 'true_false':
        return 'Apenas verdadeiro/falso.';
      case 'mixed':
        return 'Mistura: ~70% múltipla escolha, ~30% verdadeiro/falso.';
    }
  })();

  /*
    Filtro de tema: aceita string única ou múltiplos temas separados por
    vírgula (UI v0.7.1+). Múltiplos temas funcionam como OR — cada pergunta
    pode focar em qualquer um deles.
  */
  const themeInstruction = (() => {
    const raw = params.themeFilter?.trim();
    if (!raw) return '';
    const themes = raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (themes.length === 0) return '';
    if (themes.length === 1) {
      return `\n\nFILTRO DE TEMA: gere apenas perguntas que envolvam o tema "${themes[0]}". Se nenhum conceito da lista cobrir esse tema, retorne array vazio.`;
    }
    const list = themes.map((t) => `"${t}"`).join(', ');
    return `\n\nFILTRO DE TEMAS (múltiplos): gere perguntas que envolvam PELO MENOS UM dos seguintes temas: ${list}. Cada pergunta pode focar em qualquer tema da lista (interpretação OR — distribua as perguntas entre os temas quando possível). Se nenhum conceito da lista cobrir nenhum dos temas, retorne array vazio.`;
  })();

  return `Conceitos do material de estudo, AGRUPADOS POR TEMA (${nClusters} ${nClusters === 1 ? 'tema' : 'temas'}):

${clustersText}

Gere ${params.count} perguntas no total, seguindo as quotas sugeridas por tema (~${baseQuotaPerCluster}${remainder > 0 ? ` ou ${baseQuotaPerCluster + 1}` : ''} por tema). Cada pergunta deve incluir o "cluster_id" do tema de origem (ex: "${params.clusters[0]?.id ?? 'c0'}").

Tipo: ${typeInstruction}${themeInstruction}`;
}

function validateQuestion(raw: RawGeneratedQuestion, i: number): GeneratedQuestion {
  const type = raw.type;
  if (type !== 'multiple_choice' && type !== 'true_false') {
    throw new Error(`question[${i}].type inválido`);
  }

  const difficulty = raw.difficulty;
  if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') {
    throw new Error(`question[${i}].difficulty inválido`);
  }

  const question = raw.question;
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new Error(`question[${i}].question inválido`);
  }

  if (!Array.isArray(raw.options)) {
    throw new Error(`question[${i}].options não é array`);
  }
  const expectedLen = type === 'multiple_choice' ? 4 : 2;
  if (raw.options.length !== expectedLen) {
    throw new Error(
      `question[${i}].options precisa de ${expectedLen} alternativas, veio ${raw.options.length}`,
    );
  }
  const options = raw.options.map((opt, j) => {
    if (typeof opt !== 'string') {
      throw new Error(`question[${i}].options[${j}] não é string`);
    }
    return opt;
  });

  const correctIndex = raw.correct_index;
  if (
    typeof correctIndex !== 'number' ||
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex >= options.length
  ) {
    throw new Error(`question[${i}].correct_index fora do range`);
  }

  const explanation = raw.explanation;
  if (typeof explanation !== 'string' || explanation.trim().length === 0) {
    throw new Error(`question[${i}].explanation inválido`);
  }

  const conceptsRef = Array.isArray(raw.concepts_ref)
    ? raw.concepts_ref.filter((c): c is string => typeof c === 'string')
    : undefined;

  return {
    type,
    difficulty,
    question: question.trim(),
    options,
    correctIndex,
    explanation: explanation.trim(),
    ...(conceptsRef && conceptsRef.length > 0 ? { conceptsRef } : {}),
  };
}
