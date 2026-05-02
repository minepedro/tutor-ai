import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Chunks de documento — armazenam o TEXTO no SQLite e o VETOR no LanceDB.
  O `id` é a chave de junção entre os dois bancos: mesmo UUID nas duas pontas.

  ON DELETE CASCADE no schema cuida de limpar chunks SQLite quando a source
  some. Os vetores LanceDB são sincronizados manualmente em `files.ipc.ts`
  (LanceDB não tem FK).
*/

export interface DocumentChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  tokenCount: number;
  createdAt: string;
}

export interface CreateChunkInput {
  sourceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber?: number | null;
}

interface ChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  token_count: number;
  created_at: string;
}

function mapRow(row: ChunkRow): DocumentChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    pageNumber: row.page_number,
    tokenCount: row.token_count,
    createdAt: row.created_at,
  };
}

/**
 * Insere muitos chunks numa única transação. Retorna a lista de IDs na mesma
 * ordem dos inputs. Cada input pode opcionalmente já ter um `id`; se não tiver,
 * geramos um UUID.
 *
 * 💡 Transações em better-sqlite3: `db.transaction(fn)` envolve as chamadas
 * dentro de fn em um BEGIN/COMMIT atômico. Se qualquer insert falhar, faz
 * rollback automático.
 */
export function createChunksBatch(
  inputs: Array<CreateChunkInput & { id?: string }>,
): string[] {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO document_chunks (id, source_id, chunk_index, content, page_number, token_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const ids: string[] = [];

  const insertAll = db.transaction((items: typeof inputs) => {
    for (const input of items) {
      const id = input.id ?? randomUUID();
      stmt.run(
        id,
        input.sourceId,
        input.chunkIndex,
        input.content,
        input.pageNumber ?? null,
        input.tokenCount,
      );
      ids.push(id);
    }
  });

  insertAll(inputs);
  return ids;
}

export function listChunksBySource(sourceId: string): DocumentChunk[] {
  const stmt = getDb().prepare<[string], ChunkRow>(
    `SELECT id, source_id, chunk_index, content, page_number, token_count, created_at
     FROM document_chunks
     WHERE source_id = ?
     ORDER BY chunk_index ASC`,
  );
  return stmt.all(sourceId).map(mapRow);
}

export function countChunksBySource(sourceId: string): number {
  const stmt = getDb().prepare<[string], { count: number }>(
    `SELECT COUNT(*) as count FROM document_chunks WHERE source_id = ?`,
  );
  return stmt.get(sourceId)?.count ?? 0;
}

/**
 * Apaga manualmente os chunks de uma source. Normalmente o ON DELETE CASCADE
 * cuida disso quando `sources` é deletada — usa esta função quando você quer
 * re-processar uma source (limpa antes de gerar novos chunks).
 */
export function deleteChunksBySource(sourceId: string): void {
  getDb().prepare(`DELETE FROM document_chunks WHERE source_id = ?`).run(sourceId);
}
