import { complete, HAIKU_MODEL } from '../claude.service';
import { parseLooseJson } from '../../utils/json-parse';
import type { GeneratedQuestion } from './quiz-generation';

/*
  Etapa 3 do pipeline: validação.

  O modelo da etapa 2 às vezes gera:
  - Perguntas ambíguas (múltiplas respostas defensáveis)
  - Perguntas triviais (resposta óbvia já no enunciado)
  - Duplicatas conceituais (2 perguntas testando a mesma coisa)
  - Distratores ruins (alternativas obviamente erradas)

  Aqui pedimos pro modelo revisar cada pergunta com olhar crítico e marcar
  válidas/inválidas. Não regeneramos — só filtramos. Se o usuário pediu 10
  e ficaram 8 válidas, retornamos 8 (decisão consciente: simplicidade > recall).

  v0.8.4: usa Haiku 4.5 (não Sonnet 4.6). Validação binária é tarefa simples
  o suficiente pra Haiku — economia ~80% no custo + ~3× mais rápido.
  Ver ADR-042.
*/

const SYSTEM_PROMPT = `Você é um revisor crítico de quizzes acadêmicos. Sua tarefa é avaliar perguntas e filtrar as ruins.

CRITÉRIOS DE REJEIÇÃO:
1. AMBÍGUA: mais de uma alternativa pode ser defendida como correta.
2. TRIVIAL: a resposta está no próprio enunciado ou as alternativas erradas são óbvias.
3. DUPLICADA: duas perguntas testam exatamente o mesmo conceito da mesma forma.
4. DISTRATORES RUINS: alternativas erradas são absurdas (ninguém escolheria) ou irrelevantes ao contexto.
5. INCORRETA: o gabarito ou a explicação contém erro factual ou contradição.

REGRAS:
- Seja conservador: na dúvida, marque "valid": true. Não rejeite por preferência estilística.
- Em caso de duplicatas, mantenha a melhor versão e rejeite a outra com motivo "duplicada".
- A explicação só rejeita pra modelo "incorrect"; pequenas imprecisões textuais aceita.

FORMATO DE SAÍDA: APENAS um array JSON, mesma ordem das perguntas de entrada. Schema:

[
  {
    "valid": boolean,
    "rejection_reason": "ambígua" | "trivial" | "duplicada" | "distratores_ruins" | "incorrect" | null
  }
]`;

interface RawValidation {
  valid?: unknown;
  rejection_reason?: unknown;
}

export interface ValidationVerdict {
  valid: boolean;
  rejectionReason?: 'ambígua' | 'trivial' | 'duplicada' | 'distratores_ruins' | 'incorrect';
}

const VALID_REASONS = new Set([
  'ambígua',
  'trivial',
  'duplicada',
  'distratores_ruins',
  'incorrect',
]);

export async function validateQuestions(
  questions: GeneratedQuestion[],
): Promise<ValidationVerdict[]> {
  if (questions.length === 0) return [];

  const userPrompt = `Perguntas a revisar (${questions.length}):

${questions
  .map((q, i) => {
    const opts = q.options
      .map((o, j) => `  ${j === q.correctIndex ? '✓' : ' '} ${j}. ${o}`)
      .join('\n');
    return `[${i}] (${q.type}, ${q.difficulty})
${q.question}
${opts}
EXPLICAÇÃO: ${q.explanation}`;
  })
  .join('\n\n')}

Avalie cada pergunta. Retorne array JSON com ${questions.length} verdicts na mesma ordem.`;

  const response = await complete({
    model: HAIKU_MODEL, // v0.8.4: Haiku 4.5 — ~80% mais barato + ~3× mais rápido
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2, // estrito, determinístico
    maxTokens: questions.length * 80 + 500,
  });

  let parsed: RawValidation[];
  try {
    parsed = parseLooseJson<RawValidation[]>(response.content);
  } catch (err) {
    console.error(
      '[quiz-validation] resposta do modelo não é JSON válido. Início:\n',
      response.content.slice(0, 1500),
    );
    // Sem validação: assume todas válidas em vez de abortar o quiz.
    return [];
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Resposta de validação não é array');
  }

  /*
    Edge case: o modelo retorna número de verdicts diferente do número de
    perguntas. Truncamos/extendemos: nas faltantes, assumimos válido (não
    queremos perder perguntas por falha do validador).
  */
  return questions.map((_, i) => {
    const raw = parsed[i];
    if (!raw) return { valid: true };
    return normalizeVerdict(raw);
  });
}

function normalizeVerdict(raw: RawValidation): ValidationVerdict {
  const valid = raw.valid === true;
  if (valid) return { valid: true };

  const reason = raw.rejection_reason;
  if (typeof reason === 'string' && VALID_REASONS.has(reason)) {
    return {
      valid: false,
      rejectionReason: reason as ValidationVerdict['rejectionReason'],
    };
  }
  // Sem motivo válido — rejeita mas com motivo genérico.
  return { valid: false, rejectionReason: 'ambígua' };
}
