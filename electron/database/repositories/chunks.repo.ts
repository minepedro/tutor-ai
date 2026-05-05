import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, getDrizzleDb } from '../connection';
import { getLanceDb } from '../lancedb';
import { documentChunks } from '../drizzle/schema';

/*
  Chunks de documento — armazenam o TEXTO no SQLite e o VETOR no LanceDB.
  O `id` é a chave de junção entre os dois bancos: mesmo UUID nas duas pontas.

  Este arquivo unifica as operações de chunk pros dois stores (text + vector)
  porque chunk é a entidade conceitual única, mesmo que viva em dois lugares
  fisicamente. A pasta `lancedb.ts` cuida só da conexão.

  ON DELETE CASCADE no schema cuida de limpar chunks SQLite quando a source
  some. Os vetores LanceDB são sincronizados manualmente em `files.ipc.ts`
  e no pipeline de ingestão (LanceDB não tem FK).

  v0.7.3: migrado pra Drizzle, com 1 EXCEÇÃO importante — a query FTS5 (MATCH +
  bm25) continua como SQL raw via `getDb().prepare()`. Drizzle não modela
  CREATE VIRTUAL TABLE nem expressões FTS5 declarativamente.
*/

export interface DocumentChunk {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  tokenCount: number;
  /** Label estrutural detectado (ex: "exercício 5"). Null se chunk é texto contínuo. */
  structuralLabel: string | null;
  createdAt: string;
}

export interface CreateChunkInput {
  sourceId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber?: number | null;
  structuralLabel?: string | null;
}

function normalize(row: typeof documentChunks.$inferSelect): DocumentChunk {
  return {
    id: row.id,
    sourceId: row.sourceId,
    chunkIndex: row.chunkIndex ?? 0,
    content: row.content,
    pageNumber: row.pageNumber,
    tokenCount: row.tokenCount ?? 0,
    structuralLabel: row.structuralLabel,
    createdAt: row.createdAt,
  };
}

/**
 * Insere muitos chunks numa única transação. Retorna a lista de IDs na mesma
 * ordem dos inputs.
 */
export function createChunksBatch(
  inputs: Array<CreateChunkInput & { id?: string }>,
): string[] {
  const db = getDrizzleDb();
  const ids: string[] = [];

  db.transaction((tx) => {
    for (const input of inputs) {
      const id = input.id ?? randomUUID();
      tx.insert(documentChunks)
        .values({
          id,
          sourceId: input.sourceId,
          chunkIndex: input.chunkIndex,
          content: input.content,
          pageNumber: input.pageNumber ?? null,
          tokenCount: input.tokenCount,
          structuralLabel: input.structuralLabel ?? null,
        })
        .run();
      ids.push(id);
    }
  });

  return ids;
}

export function listChunksBySource(sourceId: string): DocumentChunk[] {
  const db = getDrizzleDb();
  return db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.sourceId, sourceId))
    .orderBy(asc(documentChunks.chunkIndex))
    .all()
    .map(normalize);
}

/**
 * Busca múltiplos chunks por uma lista de IDs. Usado pelo RAG depois da
 * busca vetorial: o LanceDB devolve top-K ids; aqui pegamos texto + metadados.
 */
export function getChunksByIds(ids: string[]): DocumentChunk[] {
  if (ids.length === 0) return [];
  const db = getDrizzleDb();
  return db
    .select()
    .from(documentChunks)
    .where(inArray(documentChunks.id, ids))
    .all()
    .map(normalize);
}

/**
 * Busca chunks que tenham um `structural_label` específico, dentro de um
 * conjunto de sources (escopo do RAG). Usado pra filtro estrutural —
 * "exercício 5" filtra direto, sem passar por embedding.
 */
export function listChunksByStructuralLabel(
  sourceIds: string[],
  structuralLabel: string,
): DocumentChunk[] {
  if (sourceIds.length === 0) return [];
  const db = getDrizzleDb();
  return db
    .select()
    .from(documentChunks)
    .where(
      and(
        inArray(documentChunks.sourceId, sourceIds),
        eq(documentChunks.structuralLabel, structuralLabel),
      ),
    )
    .orderBy(asc(documentChunks.sourceId), asc(documentChunks.chunkIndex))
    .all()
    .map(normalize);
}

/**
 * Item retornado pela busca FTS — chunk + posição no ranking BM25.
 */
export interface FtsResult {
  chunk: DocumentChunk;
  /** Posição 0-based no ranking BM25. */
  rank: number;
}

/**
 * Full-text search nos chunks dentro de um escopo (lista de sources).
 *
 * Drizzle não modela FTS5 (`MATCH`, `bm25()`, `document_chunks_fts` virtual).
 * Mantemos esta função usando better-sqlite3 direto com SQL raw — a única
 * exceção dentro de um repository pós-migração v0.7.3.
 */
interface ChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  page_number: number | null;
  token_count: number;
  structural_label: string | null;
  created_at: string;
}

function mapFtsRow(row: ChunkRow): DocumentChunk {
  return {
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    pageNumber: row.page_number,
    tokenCount: row.token_count,
    structuralLabel: row.structural_label,
    createdAt: row.created_at,
  };
}

export function searchChunksByFts(
  sourceIds: string[],
  query: string,
  k: number,
): FtsResult[] {
  if (sourceIds.length === 0) return [];

  const ftsQuery = buildFtsQuery(query);
  if (ftsQuery.length === 0) return []; // query sem palavras úteis

  const placeholders = sourceIds.map(() => '?').join(',');
  /*
    JOIN entre document_chunks e document_chunks_fts via rowid.
    bm25() retorna o score; ORDER BY rank ASC traz melhores primeiro.
    LIMIT cuida de pegar só top K.

    💡 Por que SQL raw aqui (e não Drizzle): FTS5 usa sintaxe específica
    (`MATCH`, função `bm25()`, virtual table) que Drizzle não suporta
    declarativamente. Mantemos better-sqlite3 puro pra essa única query.
  */
  const stmt = getDb().prepare<unknown[], ChunkRow & { fts_rank: number }>(
    `SELECT c.id, c.source_id, c.chunk_index, c.content, c.page_number,
            c.token_count, c.structural_label, c.created_at,
            bm25(document_chunks_fts) as fts_rank
     FROM document_chunks c
     JOIN document_chunks_fts fts ON c.rowid = fts.rowid
     WHERE document_chunks_fts MATCH ?
       AND c.source_id IN (${placeholders})
     ORDER BY fts_rank
     LIMIT ?`,
  );

  try {
    const rows = stmt.all(ftsQuery, ...sourceIds, k);
    return rows.map((row, idx) => ({
      chunk: mapFtsRow(row),
      rank: idx,
    }));
  } catch (err) {
    console.warn(
      '[fts] query failed, returning empty:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/**
 * Converte query do usuário em sintaxe FTS5 segura.
 * Estratégia: extrai palavras (≥3 chars), envolve cada uma em aspas,
 * une com OR. "ola mundo!" → '"ola" OR "mundo"'.
 */
function buildFtsQuery(userQuery: string): string {
  const words = userQuery
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return '';
  return words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ');
}

export function countChunksBySource(sourceId: string): number {
  const db = getDrizzleDb();
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(documentChunks)
    .where(eq(documentChunks.sourceId, sourceId))
    .get();
  return row?.count ?? 0;
}

/**
 * Apaga manualmente os chunks de uma source. Normalmente o ON DELETE CASCADE
 * cuida disso quando `sources` é deletada — usa esta função quando você quer
 * re-processar uma source (limpa antes de gerar novos chunks).
 */
export function deleteChunksBySource(sourceId: string): void {
  const db = getDrizzleDb();
  db.delete(documentChunks).where(eq(documentChunks.sourceId, sourceId)).run();
}

/**
 * Mapa retornado por `copyChunksToSource`: antigo chunk id → novo chunk id.
 */
export type IdMap = Record<string, string>;

/**
 * Duplica os chunks de uma source pra outra, gerando novos UUIDs.
 *
 * Usado pelo dedup do pipeline: quando a source nova (B) tem o mesmo
 * `content_hash` de uma source já processada (A), copiamos os chunks de A pra
 * B em vez de re-extrair/re-chunkar/re-embedar.
 */
export function copyChunksToSource(fromSourceId: string, toSourceId: string): IdMap {
  const db = getDrizzleDb();
  const oldChunks = listChunksBySource(fromSourceId);
  const idMap: IdMap = {};

  db.transaction((tx) => {
    for (const old of oldChunks) {
      const newId = randomUUID();
      idMap[old.id] = newId;
      tx.insert(documentChunks)
        .values({
          id: newId,
          sourceId: toSourceId,
          chunkIndex: old.chunkIndex,
          content: old.content,
          pageNumber: old.pageNumber,
          tokenCount: old.tokenCount,
          structuralLabel: old.structuralLabel,
        })
        .run();
    }
  });

  return idMap;
}

// ── Operações no LanceDB (vetores) ────────────────────────────────────────
// LanceDB fica fora de Drizzle (storage diferente, sem schema declarativo).

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
  await table.add(records as unknown as Array<Record<string, unknown>>);
}

/**
 * Apaga todos os vetores de uma source.
 */
export async function deleteChunkVectorsBySource(sourceId: string): Promise<void> {
  const table = await getChunksTable();
  await table.delete(`source_id = '${sourceId}'`);
}

/**
 * Lê todos os vetores de uma source.
 */
export async function listChunkVectorsBySource(
  sourceId: string,
): Promise<ChunkVectorRecord[]> {
  return listChunkVectorsBySources([sourceId]);
}

/**
 * Versão multi-source: lê vetores de N sources de uma vez (RAG escopo
 * tópico/matéria).
 */
export async function listChunkVectorsBySources(
  sourceIds: string[],
): Promise<ChunkVectorRecord[]> {
  if (sourceIds.length === 0) return [];
  const table = await getChunksTable();
  const allowed = new Set(sourceIds);

  const rows = (await table.query().toArray()) as Array<{
    id: string;
    source_id: string;
    chunk_index: number;
    vector: number[] | Float32Array;
  }>;

  return rows
    .filter((r) => allowed.has(r.source_id))
    .map((r) => ({
      id: r.id,
      source_id: r.source_id,
      chunk_index: r.chunk_index,
      vector: Array.isArray(r.vector) ? r.vector : Array.from(r.vector),
    }));
}
