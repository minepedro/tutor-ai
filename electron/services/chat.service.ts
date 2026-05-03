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

/*
  Chat service — orquestra o fluxo de uma mensagem:

  1. Salva a mensagem do usuário no DB
  2. Faz RAG: busca top K chunks relevantes
  3. Carrega histórico (últimas N mensagens, sliding window)
  4. Monta contexto (system prompt + chunks + histórico + nova msg)
  5. Chama Claude
  6. Salva a resposta com lista de chunk_ids usados
  7. Retorna a resposta + chunks usados pra UI mostrar citações

  Sliding window de histórico: 10 mensagens (5 turnos completos user+assistant).
  Sem resumo automático na v0.4.0 (decisão simples; ADR-022 do quiz tem
  raciocínio análogo: economia + simplicidade).
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
    // 2. RAG: busca chunks relevantes pra essa pergunta
    const chunks = await searchByQuery(trimmed, scope, TOP_K_CHUNKS);

    // 3. Histórico (sliding window)
    const history = getRecentMessages(conversationId, HISTORY_WINDOW_SIZE);

    // 4. Monta o user prompt da chamada (com chunks como contexto). Os trechos
    //    aparecem como bloco no prompt; o histórico vai como messages[].
    const userPrompt = buildChatUserPrompt(
      chunks.map((c) => ({
        filename: c.sourceFilename,
        chunkIndex: c.chunkIndex,
        content: c.content,
      })),
      trimmed,
    );

    /*
      Histórico → messages[] da Anthropic API. A última `user` message vai
      ser substituída pelo nosso `userPrompt` enriquecido com chunks
      (caso contrário o modelo só veria a pergunta do usuário sem contexto
      RAG nesta volta).
    */
    const messages = history
      .filter((m) => m.id !== userMessage.id) // evita duplicata da última msg
      .map((m) => ({
        role: m.role as MessageRole,
        content: m.content,
      }));

    // Adiciona a mensagem atual com o contexto RAG anexado.
    messages.push({
      role: 'user',
      content: userPrompt,
    });

    // 5. Chama Claude
    const response = await complete({
      system: CHAT_TUTOR_SYSTEM_PROMPT,
      messages,
      maxTokens: MAX_RESPONSE_TOKENS,
      temperature: 0.5, // Equilibra fidelidade ao material com naturalidade
    });

    // 6. Persiste resposta com IDs dos chunks usados
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
