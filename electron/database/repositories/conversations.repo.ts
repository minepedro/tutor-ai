import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Persistência de conversas + mensagens (chat).

  Cada conversa pertence a um escopo (document | topic | subject | inline).
  As mensagens dela compartilham o mesmo contexto de busca RAG.

  Schema (já existe desde v0.1.0):
  - `conversations`: id, title, scope_type, scope_id, created_at, updated_at
  - `messages`: id, conversation_id, role, content, context_chunks (JSON), created_at
    com ON DELETE CASCADE → apagar conversa apaga mensagens.

  💡 Decisão de design: campo `context_chunks` é JSON com a lista de chunk_ids
  usados pra responder. Permite UI mostrar "fontes" e debug. Em v1.0 isso pode
  virar tabela de junção se virar relevante consultar "quais respostas usaram
  esse chunk".
*/

export type ScopeType = 'inline' | 'document' | 'topic' | 'subject';
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

interface ConversationRow {
  id: string;
  title: string | null;
  scope_type: string;
  scope_id: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  context_chunks: string | null;
  created_at: string;
}

function mapMessage(row: MessageRow): Message {
  let contextChunkIds: string[] | null = null;
  if (row.context_chunks) {
    try {
      const parsed = JSON.parse(row.context_chunks) as unknown;
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
        contextChunkIds = parsed as string[];
      }
    } catch {
      // contexto malformado — ignora
    }
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as MessageRole,
    content: row.content,
    contextChunkIds,
    createdAt: row.created_at,
  };
}

function mapConversation(row: ConversationRow, messages: Message[]): Conversation {
  return {
    id: row.id,
    title: row.title,
    scopeType: row.scope_type as ScopeType,
    scopeId: row.scope_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
}

export function createConversation(input: CreateConversationInput): Conversation {
  const id = randomUUID();
  const stmt = getDb().prepare(
    `INSERT INTO conversations (id, title, scope_type, scope_id)
     VALUES (?, ?, ?, ?)`,
  );
  stmt.run(id, input.title ?? null, input.scopeType, input.scopeId);

  const conversation = getConversation(id);
  if (!conversation) throw new Error('Falha ao recuperar conversa recém-criada');
  return conversation;
}

export function getConversation(id: string): Conversation | null {
  const db = getDb();
  const row = db
    .prepare<[string], ConversationRow>(
      `SELECT id, title, scope_type, scope_id, created_at, updated_at
       FROM conversations WHERE id = ?`,
    )
    .get(id);
  if (!row) return null;

  const messages = db
    .prepare<[string], MessageRow>(
      `SELECT id, conversation_id, role, content, context_chunks, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(id)
    .map(mapMessage);

  return mapConversation(row, messages);
}

/**
 * Lista conversas de um escopo específico, ordenadas por `updated_at` (mais
 * recente primeiro). Inclui summary das mensagens mas não as mensagens em si.
 */
export function listConversationsByScope(
  scopeType: ScopeType,
  scopeId: string,
): ConversationSummary[] {
  const db = getDb();
  const rows = db
    .prepare<[string, string], ConversationRow>(
      `SELECT id, title, scope_type, scope_id, created_at, updated_at
       FROM conversations
       WHERE scope_type = ? AND scope_id = ?
       ORDER BY updated_at DESC`,
    )
    .all(scopeType, scopeId);

  // Pra cada conversa, conta mensagens e busca preview da última.
  // 1 query por conversa não é ideal mas pra v0.4 (poucas conversas) é OK.
  // Quando virar dor, trocar por 1 query com JOIN + window function.
  return rows.map((r) => {
    const lastMessage = db
      .prepare<[string], { content: string }>(
        `SELECT content FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(r.id);
    const count = db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?`,
      )
      .get(r.id);

    return {
      id: r.id,
      title: r.title,
      scopeType: r.scope_type as ScopeType,
      scopeId: r.scope_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: count?.count ?? 0,
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
  const db = getDb();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, context_chunks)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.conversationId,
      input.role,
      input.content,
      input.contextChunkIds && input.contextChunkIds.length > 0
        ? JSON.stringify(input.contextChunkIds)
        : null,
    );
    db.prepare(
      `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(input.conversationId);
  });
  tx();

  const message = db
    .prepare<[string], MessageRow>(
      `SELECT id, conversation_id, role, content, context_chunks, created_at
       FROM messages WHERE id = ?`,
    )
    .get(id);
  if (!message) throw new Error('Falha ao recuperar mensagem recém-criada');
  return mapMessage(message);
}

/**
 * Pega as últimas N mensagens em ordem cronológica (mais antiga → mais nova).
 * Usado pelo chat service pra montar o sliding window do contexto.
 */
export function getRecentMessages(conversationId: string, limit: number): Message[] {
  const db = getDb();
  const recent = db
    .prepare<[string, number], MessageRow>(
      `SELECT id, conversation_id, role, content, context_chunks, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
    )
    .all(conversationId, limit)
    .map(mapMessage);

  // Reverte: o resultado vem do mais recente pro mais antigo, mas o LLM
  // espera ordem cronológica (mais antigo primeiro).
  return recent.reverse();
}

export function renameConversation(id: string, title: string): Conversation {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error('Título não pode ficar vazio');
  const result = getDb()
    .prepare(`UPDATE conversations SET title = ? WHERE id = ?`)
    .run(trimmed, id);
  if (result.changes === 0) throw new Error(`Conversa ${id} não encontrada`);
  const conversation = getConversation(id);
  if (!conversation) throw new Error('Falha ao recuperar conversa após rename');
  return conversation;
}

export function deleteConversation(id: string): void {
  // CASCADE em messages → apaga mensagens junto.
  const result = getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  if (result.changes === 0) throw new Error(`Conversa ${id} não encontrada`);
}
