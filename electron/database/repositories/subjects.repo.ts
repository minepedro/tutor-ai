import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Repository pattern: toda query de uma entidade vive num arquivo só.
  O resto do app (IPC handlers, services) chama essas funções e nunca
  monta SQL. Isso facilita refactor (uma query muda só aqui) e teste
  (dá pra mockar o repo inteiro sem tocar SQLite).

  Aqui não tem nada de IPC nem de Electron — é Node puro com SQL.
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
  💡 Interface da linha "crua" do banco — espelha as colunas do schema
  (snake_case). better-sqlite3 retorna `unknown` por padrão; fazemos
  o mapeamento para o nosso `Subject` (camelCase) em `mapRow()`.
*/
interface SubjectRow {
  id: string;
  name: string;
  color: string;
  emoji: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: SubjectRow): Subject {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSubjects(): Subject[] {
  const stmt = getDb().prepare<[], SubjectRow>(
    `SELECT id, name, color, emoji, created_at, updated_at
     FROM subjects
     ORDER BY created_at DESC`,
  );
  return stmt.all().map(mapRow);
}

export function getSubject(id: string): Subject | null {
  const stmt = getDb().prepare<[string], SubjectRow>(
    `SELECT id, name, color, emoji, created_at, updated_at
     FROM subjects
     WHERE id = ?`,
  );
  const row = stmt.get(id);
  return row ? mapRow(row) : null;
}

export function createSubject(input: CreateSubjectInput): Subject {
  const trimmedName = input.name.trim();
  if (trimmedName.length === 0) {
    throw new Error('Nome da matéria não pode ficar vazio');
  }

  const id = randomUUID();
  // Schema tem DEFAULT '#7c5cfc' e DEFAULT '📚', mas passar explícito
  // só quando o usuário escolheu (ou usar os defaults via SQL omitindo).
  const color = input.color?.trim() || '#7c5cfc';
  const emoji = input.emoji?.trim() || '📚';

  const stmt = getDb().prepare(
    `INSERT INTO subjects (id, name, color, emoji)
     VALUES (?, ?, ?, ?)`,
  );
  stmt.run(id, trimmedName, color, emoji);

  // Lê de volta para devolver com created_at/updated_at preenchidos pelo SQLite.
  const created = getSubject(id);
  if (!created) {
    throw new Error('Falha ao recuperar matéria recém-criada');
  }
  return created;
}

export function updateSubject(id: string, patch: UpdateSubjectInput): Subject {
  const existing = getSubject(id);
  if (!existing) {
    throw new Error(`Matéria ${id} não encontrada`);
  }

  /*
    💡 SQL dinâmico: monta a cláusula SET só com os campos presentes no patch.
    Cada chave vira "coluna = ?" e o valor entra como parâmetro posicional —
    nunca interpolamos valor de usuário no SQL (prepared statement = sem injection).
    Se o patch vier vazio, atualizamos só `updated_at` para registrar o "toque".
  */
  const fields: string[] = [];
  const values: (string | number)[] = [];

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length === 0) {
      throw new Error('Nome da matéria não pode ficar vazio');
    }
    fields.push('name = ?');
    values.push(trimmed);
  }
  if (patch.color !== undefined) {
    fields.push('color = ?');
    values.push(patch.color.trim() || '#7c5cfc');
  }
  if (patch.emoji !== undefined) {
    fields.push('emoji = ?');
    values.push(patch.emoji.trim() || '📚');
  }

  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  const sql = `UPDATE subjects SET ${fields.join(', ')} WHERE id = ?`;
  getDb().prepare(sql).run(...values);

  const updated = getSubject(id);
  if (!updated) {
    throw new Error(`Matéria ${id} sumiu durante o update`);
  }
  return updated;
}

export function deleteSubject(id: string): void {
  // ON DELETE CASCADE no schema cuida de topics → sources → chunks → quizzes etc.
  const stmt = getDb().prepare(`DELETE FROM subjects WHERE id = ?`);
  const result = stmt.run(id);
  if (result.changes === 0) {
    throw new Error(`Matéria ${id} não encontrada`);
  }
}
