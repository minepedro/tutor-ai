/*
  Parser robusto de JSON vindo de respostas LLM. O Claude às vezes:
  - Retorna JSON puro ✓
  - Embrulha em ```json ... ``` (markdown code block)
  - Adiciona prefixo tipo "Aqui está o JSON solicitado:"
  - Adiciona texto após o JSON

  Esta função tenta extrair o JSON de qualquer um desses casos antes de
  desistir. Se ainda assim falhar, lança com a string original pra debug.
*/

export class JsonParseError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = 'JsonParseError';
  }
}

export function parseLooseJson<T = unknown>(raw: string): T {
  // Tentativa 1: parse direto
  try {
    return JSON.parse(raw) as T;
  } catch {
    // continua
  }

  // Tentativa 2: extrai bloco ```json ... ``` ou ``` ... ```
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1]) as T;
    } catch {
      // continua
    }
  }

  // Tentativa 3: extrai do primeiro `{` ou `[` ao último `}` ou `]`
  const firstBrace = Math.min(
    ...['{', '['].map((c) => {
      const i = raw.indexOf(c);
      return i === -1 ? Infinity : i;
    }),
  );
  const lastBrace = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  if (firstBrace !== Infinity && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      // continua
    }
  }

  throw new JsonParseError(
    'Não consegui extrair JSON válido da resposta do modelo',
    raw,
  );
}

/*
  Parser tolerante de array possivelmente truncado.

  Quando o LLM bate em max_tokens, o JSON termina no meio de um objeto
  (ex: `[{...}, {...}, {"question": "Quanto é...`). `JSON.parse` falha.

  Esta função extrai os objetos COMPLETOS do array, descartando o último se
  estiver incompleto. Útil pra pipeline de geração: ainda salvamos as
  perguntas que vieram bem mesmo se a última truncou.

  Algoritmo: state machine que respeita aspas e escape. Conta `{` e `}` no
  nível 0 (fora de strings) — quando depth volta a 0, o objeto está completo
  e pode ser parseado isoladamente.
*/
export function parseLooseJsonArrayPartial<T = unknown>(raw: string): T[] {
  const startIdx = raw.indexOf('[');
  if (startIdx === -1) return [];

  const items: T[] = [];
  let i = startIdx + 1;
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escape = false;

  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          items.push(JSON.parse(raw.slice(objStart, i + 1)) as T);
        } catch {
          // Objeto malformado — pula.
        }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) {
      // Array fechou normalmente.
      break;
    }
  }

  return items;
}
