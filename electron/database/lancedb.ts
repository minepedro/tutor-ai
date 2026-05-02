import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as lancedb from '@lancedb/lancedb';

let dbInstance: lancedb.Connection | null = null;

export async function getLanceDb(): Promise<lancedb.Connection> {
  if (dbInstance) return dbInstance;

  const embeddingsPath = join(app.getPath('userData'), 'embeddings');
  if (!existsSync(embeddingsPath)) {
    mkdirSync(embeddingsPath, { recursive: true });
  }

  dbInstance = await lancedb.connect(embeddingsPath);
  return dbInstance;
}

/**
 * Garante que a tabela `chunks` existe com o schema correto.
 * Chamado uma vez na inicialização do app.
 */
export async function initChunksTable(): Promise<void> {
  const db = await getLanceDb();
  const tables = await db.tableNames();

  if (!tables.includes('chunks')) {
    // Cria a tabela com um registro dummy para definir o schema,
    // depois o deleta. LanceDB precisa de pelo menos um registro para inferir schema.
    const dummy = {
      id: '__init__',
      source_id: '',
      chunk_index: 0,
      vector: Array.from({ length: 384 }, () => 0) as number[],
    };
    const table = await db.createTable('chunks', [dummy]);
    await table.delete('id = "__init__"');
  }
}

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
 * O `id` deve bater com o `id` do chunk no SQLite — é a chave de junção entre
 * os dois bancos.
 */
export async function insertChunkVectors(records: ChunkVectorRecord[]): Promise<void> {
  if (records.length === 0) return;
  const table = await getChunksTable();
  /*
    💡 Cast no boundary: LanceDB tipa o input como `Record<string, unknown>[]`
    (aceita qualquer schema). Nosso `ChunkVectorRecord` é mais estrito — todas
    as chaves são conhecidas. O cast aqui é seguro porque a interface tem só
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
 */
export async function deleteChunkVectorsBySource(sourceId: string): Promise<void> {
  const table = await getChunksTable();
  // Escape simples: id é UUID v4, então não tem ' nem outros caracteres SQL.
  await table.delete(`source_id = '${sourceId}'`);
}

/**
 * Lê todos os vetores de uma source. Usado pelo dedup pra reaproveitar
 * embeddings já calculados em outra source com o mesmo conteúdo.
 *
 * 💡 Estratégia: scan completo + filtro em JS. A API `query().where()` do
 * lancedb-node se mostrou flaky em algumas versões (trava em vez de retornar);
 * scan + filter é robusto e a tabela é pequena (centenas de vetores no v0.2.x).
 *
 * Retorna no mesmo formato de `ChunkVectorRecord`. Float32Array vindo do Arrow
 * é convertido pra number[] pra bater com o tipo de insert.
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
      // Arrow pode entregar como Float32Array; insertChunkVectors exige number[].
      vector: Array.isArray(r.vector) ? r.vector : Array.from(r.vector),
    }));
}
