import { complete } from '../claude.service';
import type { Message } from '../../database/repositories/conversations.repo';

/*
  Query rewriting pra RAG conversacional.

  Problema que resolve:
  Hoje o RAG vê só a última mensagem do usuário. Perguntas referenciais
  ("resolva esse exercício", "explica isso", "anterior") não trazem chunks
  relevantes porque a query "resolva esse exercício" é muito genérica — o
  embedding dela fica próximo de QUALQUER exercício do material.

  Solução:
  Antes de chamar `searchByQuery`, fazemos uma chamada CURTA ao Claude
  passando o histórico recente + a pergunta atual. Ele reescreve a pergunta
  de forma autônoma (sem depender do histórico). Essa pergunta reescrita
  vira a query do RAG.

  Custo: +1 chamada API por turno (~$0.001 — input ~500 tokens, output ~50).
  Latência: +1-2s.

  Ganho: chat conversacional natural funciona ("resolva esse exercício"
  encontra o exercício certo via expansão).
*/

const REWRITE_SYSTEM_PROMPT = `Você reescreve perguntas pra busca semântica em material de estudo. Sua tarefa é transformar perguntas que dependem de contexto (referências como "isso", "esse", "anterior") em perguntas AUTÔNOMAS e ESPECÍFICAS.

REGRAS:
- Use o histórico recente APENAS pra resolver referências (pronomes, "esse exercício", "o anterior")
- Não invente fatos que não estão no histórico
- Mantenha a pergunta CURTA (máximo 250 caracteres)
- Se a pergunta atual já é autônoma (não tem referências), retorne ela mesma sem mudanças
- Responda APENAS com a pergunta reescrita, sem explicação, sem aspas, sem markdown

EXEMPLOS:

Histórico:
- aluno: "mostre um exercício de produtividade"
- tutor: "Aqui está um exercício de produtividade total: a empresa tem input de R$ 66 milhões e output de 1.400.000 toneladas. Calcule a produtividade."
Pergunta atual: "resolva esse exercício"
→ Como calcular a produtividade total de uma empresa com input de R$ 66 milhões e output de 1.400.000 toneladas?

Histórico:
- aluno: "o que é capacidade efetiva?"
- tutor: "Capacidade efetiva é a quantidade que pode ser produzida descontando perdas planejadas..."
Pergunta atual: "e qual a diferença pra disponível?"
→ Qual a diferença entre capacidade efetiva e capacidade disponível?

Histórico:
- aluno: "o que é integral?"
- tutor: "Integral é a operação inversa da derivação..."
Pergunta atual: "qual a fórmula da integral por partes?"
→ qual a fórmula da integral por partes?
(JÁ é autônoma, retornou sem mudanças)`;

/**
 * Reescreve a query do usuário usando o histórico da conversa.
 *
 * Heurísticas pra evitar chamadas desnecessárias:
 * - Histórico vazio (1ª pergunta) → retorna original
 * - Query muito curta (<5 chars) → retorna original
 * - Query muito longa (>250 chars) → retorna original (já é específica)
 *
 * Em caso de erro/timeout, retorna a original (fallback robusto).
 */
export async function rewriteQueryForRag(
  history: Message[],
  query: string,
): Promise<string> {
  const trimmed = query.trim();

  // Heurísticas: pular casos onde rewriting não vai ajudar
  if (history.length === 0) return trimmed;
  if (trimmed.length < 5) return trimmed;
  if (trimmed.length > 250) return trimmed;

  /*
    Pega últimas 4 mensagens (2 turnos completos). Suficiente pra resolver
    a maioria das referências sem inflar o input. Cada msg truncada a 400
    chars pra evitar prompt gigante.
  */
  const recent = history.slice(-4);
  const contextStr = recent
    .map((m) => {
      const label = m.role === 'user' ? 'aluno' : 'tutor';
      const truncated =
        m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content;
      return `- ${label}: ${truncated}`;
    })
    .join('\n');

  try {
    const response = await complete({
      system: REWRITE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Histórico recente:\n${contextStr}\n\nPergunta atual: "${trimmed}"\n\nReescreva.`,
        },
      ],
      maxTokens: 250,
      temperature: 0.2, // baixa pra rewriting determinístico
    });

    const rewritten = response.content.trim();

    /*
      Sanity checks no output do Claude:
      - Vazio → fallback
      - Muito longa → fallback (provavelmente o modelo expandiu demais)
      - Idêntica à original (já era autônoma) → ok, retorna assim mesmo
    */
    if (rewritten.length === 0) return trimmed;
    if (rewritten.length > 500) {
      console.warn('[query-rewriter] resposta muito longa, usando original');
      return trimmed;
    }

    if (rewritten !== trimmed) {
      console.log(
        `[query-rewriter] rewrote: "${trimmed}" → "${rewritten.slice(0, 100)}${rewritten.length > 100 ? '…' : ''}"`,
      );
    }

    return rewritten;
  } catch (err) {
    console.warn(
      '[query-rewriter] erro no rewriting, usando query original:',
      err instanceof Error ? err.message : err,
    );
    return trimmed;
  }
}
