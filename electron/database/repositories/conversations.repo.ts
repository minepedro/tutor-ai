import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql, count } from 'drizzle-orm';
import { getDrizzleDb } from '../connection';
import { conversations, messages } from '../drizzle/schema';

/*
  Persistência de conversas + mensagens (chat).

  Cada conversa pertence a um escopo:
  - document/topic/subject: chat global com RAG, busca em PDFs do escopo
  - inline: reservado pra chat futuro embutido em outras telas
  - quiz_question (v0.7.0): chat inline numa pergunta de quiz; scope_id é
    quiz_question_id; SEM RAG (contexto = pergunta + alternativas + explicação)

  v0.7.3: migrado pra Drizzle. JSON do `context_chunks` continua como string
  no DB; parse/stringify em JS (Drizzle não tipa JSON nativamente em SQLite).
*/

export type ScopeType =
  | 'inline'
  | 'document'
  | 'topic'
  | 'subject'
  | 'quiz_question';
export type MessageRole = 'user' | 'assistant';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** IDs dos chunks usados como contexto (só preenchido em mensagens assistant). */
  contextChunkIds: string[] | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  scopeType: ScopeType;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

/** Versão leve usada na lista lateral (sem mensagens completas). */
export interface ConversationSummary {
  id: string;
  title: string | null;
  scopeType: ScopeType;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Primeiros ~80 chars da última mensagem (pra preview). null se vazia. */
  preview: string | null;
}

export interface CreateConversationInput {
  scopeType: ScopeType;
  scopeId: string;
  title?: string | null;
}

export interface AddMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
  contextChunkIds?: string[];
}

function normalizeMessage(row: typeof messages.$inferSelect): Message {
  let contextChunkIds: string[] | null = null;
  if (row.contextChunks) {
    try {
      const parsed = JSON.parse(row.contextChunks) as unknown;
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
        contextChunkIds = parsed as string[];
      }
    } catch {
      // contexto malformado — ignora
    }
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role as MessageRole,
    content: row.content,
    contextChunkIds,
    createdAt: row.createdAt,
  };
}

function normalizeConversation(
  row: typeof conversations.$inferSelect,
  msgs: Message[],
): Conversation {
  return {
    id: row.id,
    title: row.title,
    scopeType: row.scopeType as ScopeType,
    scopeId: row.scopeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: msgs,
  };
}

export function createConversation(input: CreateConversationInput): Conversation {
  const id = randomUUID();
  const db = getDrizzleDb();
  db.insert(conversations)
    .values({
      id,
      title: input.title ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    })
    .run();

  const conv = getConversation(id);
  if (!conv) throw new Error('Falha ao recuperar conversa recém-criada');
  return conv;
}

export function getConversation(id: string): Conversation | null {
  const db = getDrizzleDb();
  const row = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!row) return null;

  const msgs = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt), asc(sql`rowid`))
    .all()
    .map(normalizeMessage);

  return normalizeConversation(row, msgs);
}

/**
 * Acha a primeira conversa de um escopo. Usado quando um escopo tem
 * relação 1:1 com a conversa (ex: `quiz_question`).
 */
export function findConversationByScope(
  scopeType: ScopeType,
  scopeId: string,
): Conversation | null {
  const db = getDrizzleDb();
  const row = db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.scopeType, scopeType),
        eq(conversations.scopeId, scopeId),
      ),
    )
    .orderBy(asc(conversations.createdAt))
    .limit(1)
    .get();
  return row ? getConversation(row.id) : null;
}

/**
 * Lista conversas de um escopo específico, ordenadas por `updated_at` (mais
 * recente primeiro). Inclui summary das mensagens mas não as mensagens em si.
 *
 * 💡 N+1 query (1 por conversa pra count + last message). OK pra v0.4
 * (poucas conversas). Quando virar dor, otimizar com window function.
 */
export function listConversationsByScope(
  scopeType: ScopeType,
  scopeId: string,
): ConversationSummary[] {
  const db = getDrizzleDb();
  const rows = db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.scopeType, scopeType),
        eq(conversations.scopeId, scopeId),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .all();

  return rows.map((r) => {
    const lastMessage = db
      .select({ content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, r.id))
      .orderBy(desc(messages.createdAt), desc(sql`rowid`))
      .limit(1)
      .get();
    const cnt = db
      .select({ count: count() })
      .from(messages)
      .where(eq(messages.conversationId, r.id))
      .get();

    return {
      id: r.id,
      title: r.title,
      scopeType: r.scopeType as ScopeType,
      scopeId: r.scopeId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: cnt?.count ?? 0,
      preview: lastMessage?.content
        ? lastMessage.content.slice(0, 80) +
          (lastMessage.content.length > 80 ? '…' : '')
        : null,
    };
  });
}

/**
 * Adiciona mensagem à conversa. Atualiza `updated_at` da conversa pra ordenar
 * a lista lateral por atividade recente.
 */
export function addMessage(input: AddMessageInput): Message {
  const id = randomUUID();
  const db = getDrizzleDb();

  /*
    Drizzle: `db.transaction(tx => ...)` retorna o que o callback retornar.
    Mesma semântica de `better-sqlite3.transaction(fn)()` — atômica + rollback.
  */
  db.transaction((tx) => {
    tx.insert(messages)
      .values({
        id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        contextChunks:
          input.contextChunkIds && input.contextChunkIds.length > 0
            ? JSON.stringify(input.contextChunkIds)
            : null,
      })
      .run();
    tx.update(conversations)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` as unknown as string })
      .where(eq(conversations.id, input.conversationId))
      .run();
  });

  const row = db.select().from(messages).where(eq(messages.id, id)).get();
  if (!row) throw new Error('Falha ao recuperar mensagem recém-criada');
  return normalizeMessage(row);
}

/**
 * Pega as últimas N mensagens em ordem cronológica (mais antiga → mais nova).
 */
export function getRecentMessages(conversationId: string, limit: number): Message[] {
  const db = getDrizzleDb();
  const recent = db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt), desc(sql`rowid`))
    .limit(limit)
    .all()
    .map(normalizeMessage);

  // Reverte: resultado vem do mais recente pro mais antigo; LLM espera
  // ordem cronológica (mais antigo primeiro).
  return recent.reverse();
}

export function renameConversation(id: string, title: string): Conversation {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error('Título não pode ficar vazio');
  const db = getDrizzleDb();
  const result = db
    .update(conversations)
    .set({ title: trimmed })
    .where(eq(conversations.id, id))
    .run();
  if (result.changes === 0) throw new Error(`Conversa ${id} não encontrada`);
  const conv = getConversation(id);
  if (!conv) throw new Error('Falha ao recuperar conversa após rename');
  return conv;
}

export function deleteConversation(id: string): void {
  const db = getDrizzleDb();
  const result = db.delete(conversations).where(eq(conversations.id, id)).run();
  if (result.changes === 0) throw new Error(`Conversa ${id} não encontrada`);
}
