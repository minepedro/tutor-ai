import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Sources são arquivos/textos ligados a um tópico (FK ON DELETE CASCADE).
  v0.2.0 cria via upload de PDF; v0.3+ adiciona url/paste.

  - `rawText` e `extractedConcepts` ficam null no momento do upload —
    são preenchidos pelo pipeline de ingestão (Fase E/F).
  - `contentHash` é SHA-256 do conteúdo, usado para dedup tanto em disco
    quanto a nível de tópico (mesmo arquivo no mesmo tópico = mesma linha).
*/

export type SourceFileType = 'pdf' | 'txt' | 'url' | 'paste';

export interface Source {
  id: string;
  topicId: string;
  filename: string;
  fileType: SourceFileType;
  contentHash: string;
  /** Caminho absoluto do arquivo em disco (userData/sources/<hash>.<ext>). */
  filePath: string;
  rawText: string | null;
  extractedConcepts: string | null;
  /** Número de chunks indexados. 0 enquanto o pipeline não rodou. */
  chunkCount: number;
  createdAt: string;
}

export interface CreateSourceInput {
  topicId: string;
  filename: string;
  fileType: SourceFileType;
  contentHash: string;
  filePath: string;
}

interface SourceRow {
  id: string;
  topic_id: string;
  filename: string;
  file_type: string;
  content_hash: string;
  file_path: string;
  raw_text: string | null;
  extracted_concepts: string | null;
  chunk_count: number;
  created_at: string;
}

function mapRow(row: SourceRow): Source {
  return {
    id: row.id,
    topicId: row.topic_id,
    filename: row.filename,
    fileType: row.file_type as SourceFileType,
    contentHash: row.content_hash,
    filePath: row.file_path,
    rawText: row.raw_text,
    extractedConcepts: row.extracted_concepts,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
  };
}

/*
  💡 Todas as SELECTs usam LEFT JOIN com agregação COUNT pra trazer o número
  de chunks indexados sem round-trip extra. Em queries que não retornam linha
  agregada (single source), o GROUP BY é por id pra manter a contagem por fonte.
*/
const SOURCE_WITH_COUNT_SELECT = `
  SELECT s.id, s.topic_id, s.filename, s.file_type, s.content_hash, s.file_path,
         s.raw_text, s.extracted_concepts, s.created_at,
         COUNT(c.id) as chunk_count
  FROM sources s
  LEFT JOIN document_chunks c ON c.source_id = s.id
`;

export function listSourcesByTopic(topicId: string): Source[] {
  const stmt = getDb().prepare<[string], SourceRow>(
    `${SOURCE_WITH_COUNT_SELECT}
     WHERE s.topic_id = ?
     GROUP BY s.id
     ORDER BY s.created_at DESC`,
  );
  return stmt.all(topicId).map(mapRow);
}

export function getSource(id: string): Source | null {
  const stmt = getDb().prepare<[string], SourceRow>(
    `${SOURCE_WITH_COUNT_SELECT}
     WHERE s.id = ?
     GROUP BY s.id`,
  );
  const row = stmt.get(id);
  return row ? mapRow(row) : null;
}

/**
 * Procura uma source com este `contentHash` dentro do tópico. Permite o handler
 * de upload pular criação quando o mesmo arquivo já está no tópico.
 */
export function findSourceByHash(topicId: string, contentHash: string): Source | null {
  const stmt = getDb().prepare<[string, string], SourceRow>(
    `${SOURCE_WITH_COUNT_SELECT}
     WHERE s.topic_id = ? AND s.content_hash = ?
     GROUP BY s.id
     LIMIT 1`,
  );
  const row = stmt.get(topicId, contentHash);
  return row ? mapRow(row) : null;
}

export function createSource(input: CreateSourceInput): Source {
  const id = randomUUID();
  const stmt = getDb().prepare(
    `INSERT INTO sources (id, topic_id, filename, file_type, content_hash, file_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(id, input.topicId, input.filename, input.fileType, input.contentHash, input.filePath);

  const created = getSource(id);
  if (!created) throw new Error('Falha ao recuperar source recém-criada');
  return created;
}

/**
 * Atualiza apenas os campos de processamento (rawText, extractedConcepts).
 * Usado pelo pipeline de ingestão depois que o texto é extraído.
 */
export function updateSourceProcessing(
  id: string,
  patch: { rawText?: string; extractedConcepts?: string },
): Source {
  const fields: string[] = [];
  const values: string[] = [];

  if (patch.rawText !== undefined) {
    fields.push('raw_text = ?');
    values.push(patch.rawText);
  }
  if (patch.extractedConcepts !== undefined) {
    fields.push('extracted_concepts = ?');
    values.push(patch.extractedConcepts);
  }

  if (fields.length === 0) {
    const existing = getSource(id);
    if (!existing) throw new Error(`Source ${id} não encontrada`);
    return existing;
  }

  values.push(id);
  getDb().prepare(`UPDATE sources SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  const updated = getSource(id);
  if (!updated) throw new Error(`Source ${id} sumiu durante update`);
  return updated;
}

export function deleteSource(id: string): void {
  const stmt = getDb().prepare(`DELETE FROM sources WHERE id = ?`);
  const result = stmt.run(id);
  if (result.changes === 0) {
    throw new Error(`Source ${id} não encontrada`);
  }
}

/**
 * Conta quantas sources distintas apontam para o mesmo file_path.
 * Usado antes de apagar um arquivo do disco — só removemos se for a última
 * referência (várias topics podem compartilhar o mesmo arquivo via dedup).
 */
export function countSourcesByFilePath(filePath: string): number {
  const stmt = getDb().prepare<[string], { count: number }>(
    `SELECT COUNT(*) as count FROM sources WHERE file_path = ?`,
  );
  const result = stmt.get(filePath);
  return result?.count ?? 0;
}
