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
