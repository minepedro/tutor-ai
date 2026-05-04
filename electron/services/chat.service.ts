import { complete } from './claude.service';
import { searchByQuery, type RagChunk, type RagScope } from './rag.service';
import {
  addMessage,
  getConversation,
  getRecentMessages,
  type Message,
  type MessageRole,
  type ScopeType,
} from '../database/repositories/conversations.repo';
import {
  CHAT_TUTOR_SYSTEM_PROMPT,
  buildChatUserPrompt,
} from './prompts/chat-tutor';
import { rewriteQueryForRag } from './prompts/query-rewriter';

/*
  Chat service — orquestra o fluxo de uma mensagem:

  1. Salva a mensagem do usuário no DB
  2. Carrega histórico (sliding window) — antes do RAG porque é input do rewriter
  3. Query rewriting: reescreve a pergunta usando histórico (resolve referências
     tipo "esse exercício", "anterior") — chamada extra ao Claude (ADR-029)
  4. RAG: busca top K chunks usando a query reescrita
  5. Monta user prompt (chunks como contexto + pergunta ORIGINAL do usuário)
  6. Histórico → messages[] da API + nova msg com contexto RAG
  7. Chama Claude
  8. Salva resposta com lista de chunk_ids usados

  Sliding window de histórico: 10 mensagens (5 turnos completos user+assistant).
  Sem resumo automático ainda (ADR-027 — anotado em backlog).
*/

const HISTORY_WINDOW_SIZE = 10;
const TOP_K_CHUNKS = 5;
const MAX_RESPONSE_TOKENS = 2048;

export interface SendMessageResult {
  /** Mensagem do usuário persistida. */
  userMessage: Message;
  /** Resposta do assistente persistida. */
  assistantMessage: Message;
  /** Chunks que foram usados pra montar o contexto. UI mostra como "fontes". */
  chunks: RagChunk[];
}

export async function sendMessage(
  conversationId: string,
  userContent: string,
): Promise<SendMessageResult> {
  const trimmed = userContent.trim();
  if (trimmed.length === 0) {
    throw new Error('Mensagem vazia');
  }

  /*
    💡 Escopo é derivado da CONVERSA (lido do DB), não da rota atual.
    Razão: se o usuário muda de página no meio da conversa, o escopo
    da conversa permanece o que foi definido na criação. Buscar contexto
    em outro escopo no meio da conversa quebra a coerência das respostas.
  */
  const conversation = getConversation(conversationId);
  if (!conversation) {
    throw new Error(`Conversa ${conversationId} não encontrada`);
  }
  const scope = conversationScopeToRagScope(conversation.scopeType, conversation.scopeId);

  // 1. Persiste mensagem do usuário (cria registro mesmo se a chamada Claude falhar
  //    — evita perder o que o usuário escreveu).
  const userMessage = addMessage({
    conversationId,
    role: 'user',
    content: trimmed,
  });

  try {
    // 2. Histórico (sliding window) — carregado ANTES do RAG porque é input
    //    pro query rewriter (que precisa do contexto pra resolver referências).
    //    Já exclui a userMessage que acabou de ser persistida.
    const historyWithCurrent = getRecentMessages(conversationId, HISTORY_WINDOW_SIZE);
    const history = historyWithCurrent.filter((m) => m.id !== userMessage.id);

    /*
      3. Query rewriting: reescreve a pergunta usando histórico pra resolver
      referências (ex: "resolva esse exercício" → "como resolver o exercício
      de produtividade total..."). Custa +1 chamada API mas resolve perguntas
      conversacionais que o RAG cru não acerta.
    */
    const ragQuery = await rewriteQueryForRag(history, trimmed);

    // 4. RAG: busca chunks relevantes usando a query reescrita
    const chunks = await searchByQuery(ragQuery, scope, TOP_K_CHUNKS);

    // 5. Monta o user prompt (chunks como contexto + pergunta ORIGINAL do usuário).
    //    Importante usar a pergunta original aqui, não a reescrita — o Claude
    //    deve responder ao que o usuário disse, não à versão expandida pra RAG.
    const userPrompt = buildChatUserPrompt(
      chunks.map((c) => ({
        filename: c.sourceFilename,
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        structuralLabel: c.structuralLabel,
        content: c.content,
      })),
      trimmed,
    );

    /*
      6. Histórico → messages[] da API. `history` já não inclui a userMessage
      atual (filtrada acima), então adicionamos ela aqui com o contexto RAG.
    */
    const messages = history.map((m) => ({
      role: m.role as MessageRole,
      content: m.content,
    }));
    messages.push({ role: 'user', content: userPrompt });

    // 7. Chama Claude
    const response = await complete({
      system: CHAT_TUTOR_SYSTEM_PROMPT,
      messages,
      maxTokens: MAX_RESPONSE_TOKENS,
      temperature: 0.5,
    });

    // 8. Persiste resposta com IDs dos chunks usados
    const assistantMessage = addMessage({
      conversationId,
      role: 'assistant',
      content: response.content,
      contextChunkIds: chunks.map((c) => c.chunkId),
    });

    return {
      userMessage,
      assistantMessage,
      chunks,
    };
  } catch (err) {
    /*
      Se a chamada Claude falhar, ainda devolvemos a mensagem do usuário (que
      foi persistida) e propagamos o erro. UI mostra a pergunta sem resposta;
      usuário pode reenviar/esperar.
    */
    throw err;
  }
}

/*
  Converte o `scopeType + scopeId` (formato plano salvo no DB) pro `RagScope`
  discriminado que o rag.service espera. v0.4.0 não suporta `inline` ainda.
*/
function conversationScopeToRagScope(
  scopeType: ScopeType,
  scopeId: string,
): RagScope {
  switch (scopeType) {
    case 'document':
      return { type: 'document', sourceId: scopeId };
    case 'topic':
      return { type: 'topic', topicId: scopeId };
    case 'subject':
      return { type: 'subject', subjectId: scopeId };
    case 'inline':
      throw new Error(
        'Escopo "inline" não é suportado nesta versão (planejado pra v0.5+).',
      );
  }
}
