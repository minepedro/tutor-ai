import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Topics são filhos de Subjects (FK ON DELETE CASCADE no schema).
  Quase todas as queries aqui filtram por `subject_id` — listagem do "all topics"
  não tem caso de uso óbvio, então não exponho um `listAll()` agora.
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

interface TopicRow {
  id: string;
  subject_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

function mapRow(row: TopicRow): Topic {
  return {
    id: row.id,
    subjectId: row.subject_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

export function listTopicsBySubject(subjectId: string): Topic[] {
  const stmt = getDb().prepare<[string], TopicRow>(
    `SELECT id, subject_id, name, description, created_at
     FROM topics
     WHERE subject_id = ?
     ORDER BY created_at DESC`,
  );
  return stmt.all(subjectId).map(mapRow);
}

export function getTopic(id: string): Topic | null {
  const stmt = getDb().prepare<[string], TopicRow>(
    `SELECT id, subject_id, name, description, created_at
     FROM topics
     WHERE id = ?`,
  );
  const row = stmt.get(id);
  return row ? mapRow(row) : null;
}

export function createTopic(input: CreateTopicInput): Topic {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('Nome do tópico não pode ficar vazio');
  }

  const id = randomUUID();
  // description: trim e converte string vazia em null (representa "sem descrição").
  const trimmedDesc = input.description?.trim();
  const description = trimmedDesc && trimmedDesc.length > 0 ? trimmedDesc : null;

  const stmt = getDb().prepare(
    `INSERT INTO topics (id, subject_id, name, description)
     VALUES (?, ?, ?, ?)`,
  );

  /*
    💡 Se subject_id não existir, o SQLite lança "FOREIGN KEY constraint failed"
    (porque o pragma foreign_keys = ON está ativo na connection). Deixamos a
    exceção subir — quem chamou recebeu mensagem clara.
  */
  stmt.run(id, input.subjectId, trimmedName, description);

  const created = getTopic(id);
  if (!created) {
    throw new Error('Falha ao recuperar tópico recém-criado');
  }
  return created;
}

export function updateTopic(id: string, patch: UpdateTopicInput): Topic {
  const existing = getTopic(id);
  if (!existing) {
    throw new Error(`Tópico ${id} não encontrado`);
  }

  const fields: string[] = [];
  const values: (string | null)[] = [];

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new Error('Nome do tópico não pode ficar vazio');
    }
    fields.push('name = ?');
    values.push(trimmed);
  }

  if (patch.description !== undefined) {
    const trimmed = patch.description?.trim();
    fields.push('description = ?');
    values.push(trimmed && trimmed.length > 0 ? trimmed : null);
  }

  if (fields.length === 0) {
    return existing; // nada pra atualizar
  }

  values.push(id);
  const sql = `UPDATE topics SET ${fields.join(', ')} WHERE id = ?`;
  getDb().prepare(sql).run(...values);

  const updated = getTopic(id);
  if (!updated) {
    throw new Error(`Tópico ${id} sumiu durante o update`);
  }
  return updated;
}

export function deleteTopic(id: string): void {
  const stmt = getDb().prepare(`DELETE FROM topics WHERE id = ?`);
  const result = stmt.run(id);
  if (result.changes === 0) {
    throw new Error(`Tópico ${id} não encontrado`);
  }
}
