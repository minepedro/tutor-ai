import { complete } from '../claude.service';
import { parseLooseJson } from '../../utils/json-parse';

/*
  Etapa 1 do pipeline: análise do material.

  Por que essa etapa existe?
  Se mandasse o PDF inteiro com "gere 10 perguntas", o modelo iria fazer
  perguntas superficiais ou sobre metadados (capa, índice, autor). Forçando
  ele a EXTRAIR conceitos primeiro, garantimos que a etapa 2 trabalha com
  uma estrutura de conhecimento, não com texto cru.

  Output: lista de conceitos com nome, definição, importância e relações.
  Também sugere temas que o usuário pode usar como filtro.
*/

const SYSTEM_PROMPT = `Você é um analista de material de estudo. Sua tarefa é ler um texto acadêmico e extrair os conceitos centrais de forma estruturada.

REGRAS:
- Ignore metadados do documento (capa, autor, página, índice, referências bibliográficas)
- Foque no conteúdo acadêmico: conceitos, definições, fórmulas, processos, classificações
- Diferencie conceitos "core" (essenciais pro tópico) de "supporting" (contexto adicional)
- Conceitos relacionados ajudam a montar perguntas comparativas depois
- Se o material está em português, devolva tudo em português

FORMATO DE SAÍDA: APENAS um objeto JSON, sem texto antes ou depois, sem markdown. Schema:

{
  "concepts": [
    {
      "name": "string — nome curto do conceito",
      "definition": "string — definição/explicação em 1-3 frases",
      "importance": "core" | "supporting",
      "related": ["string"]  // opcional, nomes de outros conceitos relacionados
    }
  ],
  "suggested_themes": ["string"]  // 3-8 temas amplos que agrupam os conceitos
}`;

export interface ExtractedConcept {
  name: string;
  definition: string;
  importance: 'core' | 'supporting';
  related?: string[];
}

export interface AnalysisResult {
  concepts: ExtractedConcept[];
  suggestedThemes: string[];
}

interface RawAnalysisResponse {
  concepts?: unknown;
  suggested_themes?: unknown;
}

/**
 * Limite de caracteres do material que mandamos pro Claude. Sonnet 4.x aceita
 * 200k tokens (~600k chars), mas mais material = mais custo + latência. 50k
 * chars (~12.5k tokens) cobre PDFs acadêmicos típicos sem virar caro.
 */
const MAX_MATERIAL_CHARS = 50_000;

export async function analyzeMaterial(rawText: string): Promise<AnalysisResult> {
  const truncated =
    rawText.length > MAX_MATERIAL_CHARS
      ? rawText.slice(0, MAX_MATERIAL_CHARS) + '\n\n[material truncado por tamanho]'
      : rawText;

  const response = await complete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Analise o material a seguir e extraia os conceitos:\n\n---\n${truncated}\n---`,
      },
    ],
    temperature: 0.3,
    maxTokens: 4096,
  });

  let parsed: RawAnalysisResponse;
  try {
    parsed = parseLooseJson<RawAnalysisResponse>(response.content);
  } catch (err) {
    // Ajuda diagnóstico: mostra os primeiros chars da resposta crua no terminal.
    console.error(
      '[quiz-analysis] resposta do modelo não é JSON válido. Início da resposta:\n',
      response.content.slice(0, 1500),
    );
    throw new Error(
      'O modelo retornou uma resposta inválida ao analisar o material. ' +
        'Pode ser PDF muito bagunçado (fórmulas, símbolos especiais). Tente outro material.',
    );
  }
  return validateAndNormalize(parsed);
}

function validateAndNormalize(raw: RawAnalysisResponse): AnalysisResult {
  if (!Array.isArray(raw.concepts)) {
    throw new Error('Resposta da análise sem array "concepts"');
  }

  const concepts: ExtractedConcept[] = raw.concepts.map((c, i) => {
    if (typeof c !== 'object' || c === null) {
      throw new Error(`concepts[${i}] não é objeto`);
    }
    const obj = c as Record<string, unknown>;

    const name = obj['name'];
    const definition = obj['definition'];
    const importance = obj['importance'];

    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(`concepts[${i}].name inválido`);
    }
    if (typeof definition !== 'string' || definition.trim().length === 0) {
      throw new Error(`concepts[${i}].definition inválido`);
    }
    if (importance !== 'core' && importance !== 'supporting') {
      throw new Error(`concepts[${i}].importance deve ser 'core' ou 'supporting'`);
    }

    const related = obj['related'];
    return {
      name: name.trim(),
      definition: definition.trim(),
      importance,
      ...(Array.isArray(related)
        ? { related: related.filter((r): r is string => typeof r === 'string') }
        : {}),
    };
  });

  const themes = Array.isArray(raw.suggested_themes)
    ? raw.suggested_themes.filter((t): t is string => typeof t === 'string')
    : [];

  return { concepts, suggestedThemes: themes };
}
