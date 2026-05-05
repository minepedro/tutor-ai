import { complete } from '../claude.service';
import { parseLooseJson } from '../../utils/json-parse';

/*
  Prompt LEVE pra "Sugerir temas" no QuizSetup (v0.7.4+).

  Diferença pro `quiz-analysis.ts`:
  - Aquele faz a ANÁLISE COMPLETA do material: extrai conceitos, definições,
    importância, relações, temas. Output ~3000 tokens, demora 10-25s.
  - Esse prompt extrai SÓ os temas (4-8 chips curtos pra UI). Output ~150
    tokens, demora 1-3s por source.

  Trade-off: o resultado deste prompt NÃO é cacheado em `extracted_concepts`
  (esse campo é usado pelo pipeline real de geração de quiz, que precisa da
  análise completa). Quando o aluno apertar "Gerar quiz", a análise completa
  ainda roda e cacheia tudo. Sem desperdício.

  💡 Pra ser ainda mais rápido em PDFs grandes, truncamos pra 15k chars (vs
  50k da análise completa). Pra detectar temas amplos isso é mais que
  suficiente — temas como "termodinâmica", "produtividade", "naturalismo"
  aparecem nos primeiros parágrafos/capítulos.
*/

const SYSTEM_PROMPT = `Você extrai TEMAS DE ESTUDO de um material acadêmico. Responde com 4-8 temas curtos (1-3 palavras cada) que cobrem o conteúdo principal.

REGRAS:
- Tema = assunto AMPLO. Não é conceito específico. Ex: "Derivadas", "Sistema Toyota de Produção", "Realismo brasileiro".
- 1-3 palavras cada tema. Sem frases.
- Ignore metadados (capa, autor, índice, referências bibliográficas).
- Se o material está em português, devolva tudo em português.
- Mínimo 4, máximo 8 temas.

FORMATO DE SAÍDA: APENAS um array JSON de strings, sem texto antes/depois, sem markdown.

Exemplo: ["Derivadas", "Integrais", "Limites", "Continuidade"]`;

const MAX_CHARS = 15_000;

/**
 * Sugere temas a partir do texto cru de um source. Output direto pro UI
 * (chips do QuizSetup).
 *
 * Tolerante a falha: se Claude retornar JSON malformado, retorna `[]` em
 * vez de quebrar o handler. Caller pode mostrar a UI vazia + opção de
 * digitar tema livre manualmente.
 */
export async function suggestThemesFromText(rawText: string): Promise<string[]> {
  if (!rawText || rawText.trim().length === 0) return [];

  const truncated =
    rawText.length > MAX_CHARS
      ? rawText.slice(0, MAX_CHARS) + '\n\n[material truncado por tamanho]'
      : rawText;

  try {
    const response = await complete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Liste os temas deste material:\n\n---\n${truncated}\n---`,
        },
      ],
      temperature: 0.3,
      maxTokens: 256,
    });

    const parsed = parseLooseJson<unknown>(response.content);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim())
      .slice(0, 8); // hard cap caso Claude exagere
  } catch (err) {
    console.warn(
      '[theme-suggester] falhou, retornando [] (UI mostra input livre):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
