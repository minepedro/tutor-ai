import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as lancedb from '@lancedb/lancedb';

/*
  Conexão com o LanceDB (singleton) + bootstrap da tabela `chunks`.
  Helpers de leitura/escrita de chunks vivem em `repositories/chunks.repo.ts`
  (centralizam SQLite + LanceDB no mesmo módulo, já que chunk é a entidade
  conceitual que existe em ambos os stores).

  v0.7.2: caller injeta `userDataPath` via `configureLanceDbPath()` ANTES
  da primeira chamada a `getLanceDb()`. Sem imports de Electron aqui.
*/

let dbInstance: lancedb.Connection | null = null;
let userDataPath: string | null = null;

export function configureLanceDbPath(path: string): void {
  userDataPath = path;
}

export async function getLanceDb(): Promise<lancedb.Connection> {
  if (dbInstance) return dbInstance;
  if (!userDataPath) {
    throw new Error(
      'LanceDB não configurado. Chame configureLanceDbPath() no boot.',
    );
  }

  const embeddingsPath = join(userDataPath, 'embeddings');
  if (!existsSync(embeddingsPath)) {
    mkdirSync(embeddingsPath, { recursive: true });
  }

  dbInstance = await lancedb.connect(embeddingsPath);
  return dbInstance;
}

/**
 * Garante que a tabela `chunks` existe com o schema correto.
 * Chamado uma vez na inicialização do app (em main.ts).
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
