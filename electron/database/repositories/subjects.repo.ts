import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../connection';
import { subjects } from '../drizzle/schema';

/*
  Repository pattern: toda query de uma entidade vive num arquivo só.
  O resto do app (IPC handlers, services) chama essas funções e nunca
  monta SQL. Isso facilita refactor (uma query muda só aqui) e teste.

  v0.7.3: migrado pra Drizzle. Tipos inferidos automaticamente do schema.ts;
  conversão snake_case → camelCase é nativa do Drizzle (campo declarado em
  TS no schema vira a chave do objeto retornado). Mapeamento manual
  (`mapRow`) deletado.
*/

export interface Subject {
  id: string;
  name: string;
  color: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectInput {
  name: string;
  color?: string;
  emoji?: string;
}

export type UpdateSubjectInput = Partial<CreateSubjectInput>;

/*
  💡 Drizzle infere tipos do schema. As colunas declaradas como `.notNull()`
  vêm tipadas como string; as nullable vêm como `string | null`. Pra Subject
  todos os campos são notNull (color/emoji têm default), então normalize com
  fallback caso valor venha null por DB legacy.
*/
function normalize(row: typeof subjects.$inferSelect): Subject {
  return {
    id: row.id,
    name: row.name,
    color: row.color ?? '#7c5cfc',
    emoji: row.emoji ?? '📚',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listSubjects(): Subject[] {
  const db = getDrizzleDb();
  const rows = db.select().from(subjects).orderBy(sql`${subjects.createdAt} DESC`).all();
  return rows.map(normalize);
}

export function getSubject(id: string): Subject | null {
  const db = getDrizzleDb();
  const row = db.select().from(subjects).where(eq(subjects.id, id)).get();
  return row ? normalize(row) : null;
}

export function createSubject(input: CreateSubjectInput): Subject {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('Nome da matéria não pode ficar vazio');
  }

  const id = randomUUID();
  const color = input.color?.trim() || '#7c5cfc';
  const emoji = input.emoji?.trim() || '📚';

  const db = getDrizzleDb();
  db.insert(subjects).values({ id, name: trimmedName, color, emoji }).run();

  // Lê de volta para devolver com created_at/updated_at preenchidos pelo SQLite.
  const created = getSubject(id);
  if (!created) throw new Error('Falha ao recuperar matéria recém-criada');
  return created;
}

export function updateSubject(id: string, patch: UpdateSubjectInput): Subject {
  const existing = getSubject(id);
  if (!existing) {
    throw new Error(`Matéria ${id} não encontrada`);
  }

  /*
    Drizzle aceita objeto parcial em `.set()` — só os campos presentes vão
    pro UPDATE. Igual ao SQL dinâmico que tinha antes, mas sem montar string.
    `updated_at` é forçado via SQL literal (CURRENT_TIMESTAMP).
  */
  const updates: Partial<typeof subjects.$inferInsert> = {
    updatedAt: sql`CURRENT_TIMESTAMP` as unknown as string,
  };

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new Error('Nome da matéria não pode ficar vazio');
    }
    updates.name = trimmed;
  }
  if (patch.color !== undefined) {
    updates.color = patch.color.trim() || '#7c5cfc';
  }
  if (patch.emoji !== undefined) {
    updates.emoji = patch.emoji.trim() || '📚';
  }

  const db = getDrizzleDb();
  db.update(subjects).set(updates).where(eq(subjects.id, id)).run();

  const updated = getSubject(id);
  if (!updated) throw new Error(`Matéria ${id} sumiu durante o update`);
  return updated;
}

export function deleteSubject(id: string): void {
  // ON DELETE CASCADE no schema cuida de topics → sources → chunks → quizzes etc.
  const db = getDrizzleDb();
  const result = db.delete(subjects).where(eq(subjects.id, id)).run();
  if (result.changes === 0) {
    throw new Error(`Matéria ${id} não encontrada`);
  }
}
