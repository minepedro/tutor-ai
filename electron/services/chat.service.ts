import { complete } from './claude.service';
import { searchByQuery, type RagChunk, type RagScope } from './rag.service';
import {
  addMessage,
  createConversation,
  findConversationByScope,
  getConversation,
  getRecentMessages,
  type Conversation,
  type Message,
  type MessageRole,
  type ScopeType,
} from '../database/repositories/conversations.repo';
import { getQuizQuestion } from '../database/repositories/quizzes.repo';
import {
  CHAT_TUTOR_SYSTEM_PROMPT,
  buildChatUserPrompt,
} from './prompts/chat-tutor';
import {
  buildQuizTutorSystemPrompt,
  type QuizQuestionContext,
} from './prompts/quiz-tutor';
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

  Sliding window de histórico: 20 mensagens (10 turnos completos user+assistant).
  Aumentado de 10 → 20 em v0.7.0 pra cobrir conversas mais longas, especialmente
  no chat inline de quiz onde aluno tende a fazer várias perguntas seguidas.
  Sem resumo automático ainda (ADR-027 — anotado em backlog).
*/

const HISTORY_WINDOW_SIZE = 20;
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
  discriminado que o rag.service espera.

  Escopos com RAG: document | topic | subject.
  Escopos sem RAG (não passam por aqui): inline (reservado), quiz_question
  (chat inline de quiz, ver `sendQuizDoubt` abaixo).
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
    case 'global':
      // v0.8.0: scopeId é literal 'global' (não usado no RAG, mas necessário
      // pro NOT NULL do schema). RAG cobre TODAS as sources.
      return { type: 'global' };
    case 'inline':
      throw new Error(
        'Escopo "inline" não é suportado nesta versão (planejado pra v0.5+).',
      );
    case 'quiz_question':
      throw new Error(
        'Escopo "quiz_question" usa pipeline próprio (sendQuizDoubt), não passa por sendMessage.',
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat inline em pergunta de quiz (v0.7.0)
// ═══════════════════════════════════════════════════════════════════════════

const QUIZ_DOUBT_RESPONSE_TOKENS = 1024;

export interface QuizDoubtResult {
  /** Conversation usada (criada lazy se não existia). */
  conversation: Conversation;
  userMessage: Message;
  assistantMessage: Message;
}

/**
 * Envia uma dúvida do aluno sobre uma pergunta específica de quiz.
 *
 * Pipeline (mais simples que `sendMessage`):
 * 1. Carrega contexto da pergunta de quiz (pergunta, alternativas, correta, explicação, escolha)
 * 2. Acha ou cria conversation com scope_type='quiz_question', scope_id=quizQuestionId
 * 3. Persiste user message
 * 4. Carrega histórico (sliding window)
 * 5. Monta system prompt INJETANDO o contexto da pergunta (pra sobreviver ao window)
 * 6. Chama Claude SEM RAG, SEM rewriter
 * 7. Persiste resposta
 *
 * Sem RAG: o contexto da pergunta + explicação oficial cobre o caso de uso.
 * Pra dúvidas tangenciais sobre o material, system prompt orienta o aluno
 * a usar o chat global. (RAG dentro do quiz vai pra v0.7+ — ver BACKLOG.)
 */
export async function sendQuizDoubt(
  quizQuestionId: string,
  userContent: string,
): Promise<QuizDoubtResult> {
  const trimmed = userContent.trim();
  if (trimmed.length === 0) {
    throw new Error('Mensagem vazia');
  }

  // 1. Contexto da pergunta de quiz (pergunta, opções, correta, explicação, escolha)
  const quizQuestion = getQuizQuestion(quizQuestionId);
  if (!quizQuestion) {
    throw new Error(`Pergunta de quiz ${quizQuestionId} não encontrada`);
  }

  const ctx: QuizQuestionContext = {
    question: quizQuestion.question,
    options: quizQuestion.options,
    correctIndex: quizQuestion.correctIndex,
    explanation: quizQuestion.explanation,
    selectedIndex: quizQuestion.selectedIndex,
  };

  // 2. Lazy create: 1 conversation por quiz_question
  let conversation = findConversationByScope('quiz_question', quizQuestionId);
  if (!conversation) {
    conversation = createConversation({
      scopeType: 'quiz_question',
      scopeId: quizQuestionId,
    });
  }

  // 3. Persiste user message ANTES da chamada Claude (não perde se falhar)
  const userMessage = addMessage({
    conversationId: conversation.id,
    role: 'user',
    content: trimmed,
  });

  // 4. Sliding window (já inclui a userMessage; vamos filtrar e re-adicionar)
  const historyWithCurrent = getRecentMessages(conversation.id, HISTORY_WINDOW_SIZE);
  const history = historyWithCurrent.filter((m) => m.id !== userMessage.id);

  // 5. System prompt com contexto da pergunta injetado (sobrevive a sliding window)
  const systemPrompt = buildQuizTutorSystemPrompt(ctx);

  // 6. Mensagens pra Claude: histórico + nova dúvida (sem chunks, é texto cru)
  const messages = history.map((m) => ({
    role: m.role as MessageRole,
    content: m.content,
  }));
  messages.push({ role: 'user', content: trimmed });

  const response = await complete({
    system: systemPrompt,
    messages,
    maxTokens: QUIZ_DOUBT_RESPONSE_TOKENS,
    temperature: 0.5,
  });

  // 7. Persiste resposta. contextChunkIds=[] porque sem RAG.
  const assistantMessage = addMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: response.content,
  });

  // Recarrega pra incluir as 2 mensagens novas
  const updated = getConversation(conversation.id);
  if (!updated) throw new Error('Falha ao recuperar conversa após persistir');

  return {
    conversation: updated,
    userMessage,
    assistantMessage,
  };
}

/**
 * Lista mensagens da conversa de dúvidas de uma pergunta de quiz.
 * Retorna [] se ainda não há conversa (aluno não abriu o chat ainda).
 */
export function getQuizDoubtConversation(
  quizQuestionId: string,
): Conversation | null {
  return findConversationByScope('quiz_question', quizQuestionId);
}
