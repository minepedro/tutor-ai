import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../connection';
import { topics } from '../drizzle/schema';

/*
  Topics são filhos de Subjects (FK ON DELETE CASCADE no schema).
  Quase todas as queries aqui filtram por `subject_id` — listagem do "all topics"
  não tem caso de uso óbvio, então não exponho um `listAll()` agora.

  v0.7.3: migrado pra Drizzle.
*/

export interface Topic {
  id: string;
  subjectId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateTopicInput {
  subjectId: string;
  name: string;
  description?: string;
}

export interface UpdateTopicInput {
  name?: string;
  description?: string | null;
}

function normalize(row: typeof topics.$inferSelect): Topic {
  return {
    id: row.id,
    subjectId: row.subjectId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
  };
}

export function listTopicsBySubject(subjectId: string): Topic[] {
  const db = getDrizzleDb();
  return db
    .select()
    .from(topics)
    .where(eq(topics.subjectId, subjectId))
    .orderBy(sql`${topics.createdAt} DESC`)
    .all()
    .map(normalize);
}

export function getTopic(id: string): Topic | null {
  const db = getDrizzleDb();
  const row = db.select().from(topics).where(eq(topics.id, id)).get();
  return row ? normalize(row) : null;
}

export function createTopic(input: CreateTopicInput): Topic {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('Nome do tópico não pode ficar vazio');
  }

  const id = randomUUID();
  // description: trim e converte string vazia em null.
  const trimmedDesc = input.description?.trim();
  const description = trimmedDesc && trimmedDesc.length > 0 ? trimmedDesc : null;

  /*
    💡 Se subject_id não existir, SQLite lança "FOREIGN KEY constraint failed"
    (foreign_keys = ON ativo). Deixamos a exceção subir.
  */
  const db = getDrizzleDb();
  db.insert(topics)
    .values({ id, subjectId: input.subjectId, name: trimmedName, description })
    .run();

  const created = getTopic(id);
  if (!created) throw new Error('Falha ao recuperar tópico recém-criado');
  return created;
}

export function updateTopic(id: string, patch: UpdateTopicInput): Topic {
  const existing = getTopic(id);
  if (!existing) {
    throw new Error(`Tópico ${id} não encontrado`);
  }

  const updates: Partial<typeof topics.$inferInsert> = {};

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new Error('Nome do tópico não pode ficar vazio');
    }
    updates.name = trimmed;
  }

  if (patch.description !== undefined) {
    const trimmed = patch.description?.trim();
    updates.description = trimmed && trimmed.length > 0 ? trimmed : null;
  }

  if (Object.keys(updates).length === 0) {
    return existing; // nada pra atualizar
  }

  const db = getDrizzleDb();
  db.update(topics).set(updates).where(eq(topics.id, id)).run();

  const updated = getTopic(id);
  if (!updated) throw new Error(`Tópico ${id} sumiu durante o update`);
  return updated;
}

export function deleteTopic(id: string): void {
  const db = getDrizzleDb();
  const result = db.delete(topics).where(eq(topics.id, id)).run();
  if (result.changes === 0) {
    throw new Error(`Tópico ${id} não encontrado`);
  }
}
