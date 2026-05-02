import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';
import { getLanceDb } from '../lancedb';

/*
  Chunks de documento — armazenam o TEXTO no SQLite e o VETOR no LanceDB.
  O `id` é a chave de junção entre os dois bancos: mesmo UUID nas duas pontas.

  Este arquivo unifica as operações de chunk pros dois stores (text + vector)
  porque chunk é a entidade conceitual única, mesmo que viva em dois lugares
  fisicamente. A pasta `lancedb.ts` cuida só da conexão.

  ON DELETE CASCADE no schema cuida de limpar chunks SQLite quando a source
  some. Os vetores LanceDB são sincronizados manualmente em `files.ipc.ts`
  e no pipeline de ingestão (LanceDB não tem FK).
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

/**
 * Mapa retornado por `copyChunksToSource`: antigo chunk id → novo chunk id.
 * O caller usa esse mapa pra sincronizar os vetores no LanceDB com os mesmos
 * IDs novos (chave de junção entre os dois bancos).
 */
export type IdMap = Record<string, string>;

/**
 * Duplica os chunks de uma source pra outra, gerando novos UUIDs.
 *
 * Usado pelo dedup do pipeline: quando a source nova (B) tem o mesmo
 * `content_hash` de uma source já processada (A), copiamos os chunks de A pra
 * B em vez de re-extrair/re-chunkar/re-embedar. Cada chunk copiado precisa de
 * novo id (PK), e o conteúdo (`content`, `chunk_index`, `page_number`,
 * `token_count`) vem do original.
 *
 * Retorna `IdMap` mapeando ids antigos → novos. O caller usa esse mapa pra
 * copiar os vetores correspondentes no LanceDB com os mesmos ids novos.
 */
export function copyChunksToSource(fromSourceId: string, toSourceId: string): IdMap {
  const db = getDb();
  const oldChunks = listChunksBySource(fromSourceId);

  const insertStmt = db.prepare(
    `INSERT INTO document_chunks (id, source_id, chunk_index, content, page_number, token_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const idMap: IdMap = {};
  const copyAll = db.transaction(() => {
    for (const old of oldChunks) {
      const newId = randomUUID();
      idMap[old.id] = newId;
      insertStmt.run(
        newId,
        toSourceId,
        old.chunkIndex,
        old.content,
        old.pageNumber,
        old.tokenCount,
      );
    }
  });
  copyAll();

  return idMap;
}

// ── Operações no LanceDB (vetores) ────────────────────────────────────────

export interface ChunkVectorRecord {
  id: string;
  source_id: string;
  chunk_index: number;
  vector: number[];
}

async function getChunksTable() {
  const db = await getLanceDb();
  return db.openTable('chunks');
}

/**
 * Insere vetores de chunks no LanceDB. Aceita batch (mais rápido que loop).
 * O `id` deve bater com o `id` do chunk no SQLite — chave de junção.
 */
export async function insertChunkVectors(records: ChunkVectorRecord[]): Promise<void> {
  if (records.length === 0) return;
  const table = await getChunksTable();
  /*
    💡 Cast no boundary: LanceDB tipa o input como `Record<string, unknown>[]`
    (aceita qualquer schema). Nosso `ChunkVectorRecord` é mais estrito — todas
    as chaves são conhecidas. Cast aqui é seguro porque a interface tem só
    chaves string e LanceDB não introspecciona a "extensão" do tipo.
  */
  await table.add(records as unknown as Array<Record<string, unknown>>);
}

/**
 * Apaga todos os vetores de uma source. Usado quando a source é removida —
 * o cascade do SQLite limpa `document_chunks`, mas o LanceDB precisa ser
 * sincronizado explicitamente porque vive em outro storage.
 *
 * 💡 LanceDB usa SQL-like predicate strings; aspas simples escapam o id.
 *    UUID v4 não tem aspas internas, então concatenação é segura.
 */
export async function deleteChunkVectorsBySource(sourceId: string): Promise<void> {
  const table = await getChunksTable();
  await table.delete(`source_id = '${sourceId}'`);
}

/**
 * Lê todos os vetores de uma source. Usado pelo dedup pra reaproveitar
 * embeddings já calculados em outra source com o mesmo conteúdo.
 *
 * 💡 Estratégia: scan completo + filtro em JS. A API `query().where()` do
 * lancedb-node se mostrou flaky em algumas versões (trava em vez de retornar);
 * scan + filter é robusto e a tabela é pequena (centenas-milhares de vetores).
 *
 * Retorna no formato `ChunkVectorRecord`. Float32Array vindo do Arrow é
 * convertido pra number[] pra bater com o tipo de insert.
 */
export async function listChunkVectorsBySource(
  sourceId: string,
): Promise<ChunkVectorRecord[]> {
  const table = await getChunksTable();

  const rows = (await table.query().toArray()) as Array<{
    id: string;
    source_id: string;
    chunk_index: number;
    vector: number[] | Float32Array;
  }>;

  return rows
    .filter((r) => r.source_id === sourceId)
    .map((r) => ({
      id: r.id,
      source_id: r.source_id,
      chunk_index: r.chunk_index,
      vector: Array.isArray(r.vector) ? r.vector : Array.from(r.vector),
    }));
}
