import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import schema from './schema.sql?raw';
import * as drizzleSchema from './drizzle/schema';

/*
  💡 Singleton pattern: uma única instância do banco compartilhada por todo o
  processo main. A variável `instance` guarda a conexão aberta; nas chamadas
  seguintes `getDb()` retorna ela sem reabrir o arquivo.

  v0.7.2: o caller injeta o `userDataPath` via `configureDatabasePath()`
  ANTES da primeira chamada a `getDb()`. Isso desacopla o módulo de
  Electron — quando virar web, troca pela path equivalente do server.
*/
let instance: Database.Database | null = null;
let drizzleInstance: BetterSQLite3Database<typeof drizzleSchema> | null = null;
let userDataPath: string | null = null;

/**
 * Configura o caminho do diretório de dados. Chamar no composition root
 * (main.ts dentro de app.whenReady) ANTES da primeira chamada a `getDb()`.
 */
export function configureDatabasePath(path: string): void {
  userDataPath = path;
}

export function getDb(): Database.Database {
  if (instance) return instance;
  if (!userDataPath) {
    throw new Error(
      'Database não configurado. Chame configureDatabasePath() no boot.',
    );
  }

  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  const dbPath = join(userDataPath, 'database.db');
  instance = new Database(dbPath);

  // WAL: leituras e escritas não se bloqueiam mutuamente — melhor performance.
  // foreign_keys: ativa verificação de FOREIGN KEY constraints.
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  // Todas as tabelas usam CREATE TABLE IF NOT EXISTS → idempotente,
  // pode rodar em toda inicialização sem duplicar nada.
  instance.exec(schema);

  // Migrations leves pra DBs criados em versões anteriores. Cada migration
  // é idempotente (checa se já foi aplicada).
  applyMigrations(instance);

  /*
    💡 v0.7.3 — Caminho de migrations futuras (drizzle-kit):

    Hoje o boot do DB combina `schema.sql` (idempotente) + `applyMigrations`
    ad-hoc (cobre DBs pré-v0.6). Funciona pra DBs existentes, sem migration
    framework ainda ATIVO.

    Pra adicionar uma nova migration daqui pra frente:
    1. Editar `electron/database/drizzle/schema.ts` (declarar mudança)
    2. Rodar `npx drizzle-kit generate --name=descricao_da_mudanca`
       (gera `0001_descricao.sql` em `electron/database/migrations/`)
    3. Aplicar manualmente em `applyMigrations` por enquanto, OU
    4. Quando for hora: ativar `migrate(getDrizzleDb(), { migrationsFolder })`
       aqui (vai exigir bootstrap pra DB legacy — popular __drizzle_migrations
       sem re-rodar 0000_initial_baseline). Anotado em BACKLOG.

    Por que ainda não ativamos o `migrate()` agora? Pra DBs legacy (de quem
    instalou v0.7.2 ou antes), `migrate()` tentaria rodar
    `0000_initial_baseline.sql` que faz CREATE TABLE sem IF NOT EXISTS — daria
    erro "table already exists". Evitamos esse risco no release atual; ativação
    é trabalho focado pra próxima v0.8.x.
  */

  return instance;
}

/*
  Aplica ALTER TABLE pra DBs existentes que precisam de colunas novas.
  PRAGMA table_info retorna metadados das colunas; comparamos pra decidir.
*/
function applyMigrations(db: Database.Database): void {
  // v0.5.0: adiciona structural_label em document_chunks pra DBs criados
  // antes da v0.5 (CREATE TABLE IF NOT EXISTS não adiciona colunas novas
  // a tabelas já existentes).
  const chunkColumns = db
    .prepare('PRAGMA table_info(document_chunks)')
    .all() as Array<{ name: string }>;
  const hasStructuralLabel = chunkColumns.some((c) => c.name === 'structural_label');
  if (!hasStructuralLabel) {
    db.exec('ALTER TABLE document_chunks ADD COLUMN structural_label TEXT');
  }

  /*
    v0.6.0: backfill da tabela FTS5 pra DBs que tinham chunks antes da
    introdução do índice. Os triggers (afterInsert) só populam chunks
    NOVOS — chunks antigos ficaram fora do índice.

    💡 IMPORTANTE: em external content tables (`content=document_chunks`),
    `INSERT INTO fts(rowid, content) SELECT ...` insere as rows MAS NÃO
    popula o índice invertido — MATCH retorna 0 mesmo a contagem batendo.
    A forma correta é o comando especial `INSERT INTO fts(fts) VALUES('rebuild')`
    que reconstrói o índice lendo a tabela externa.

    Detecção: schema.sql já cria a FTS via CREATE VIRTUAL TABLE IF NOT
    EXISTS. Testamos o índice com um MATCH dummy contra um termo que
    sabemos existir — se vier 0, rebuild.
  */
  try {
    const chunksCount = (
      db
        .prepare('SELECT COUNT(*) as count FROM document_chunks')
        .get() as { count: number }
    ).count;

    if (chunksCount > 0) {
      // Heurística: pega 1 palavra real do 1º chunk e testa MATCH. Se não
      // achar nada, o índice está vazio (caso clássico: backfill antigo
      // só inseriu rows sem indexar).
      const sample = db
        .prepare(
          "SELECT content FROM document_chunks WHERE length(content) > 10 LIMIT 1",
        )
        .get() as { content: string } | undefined;
      const probe = sample?.content
        ?.replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .find((w) => w.length >= 4);

      if (probe) {
        const hits = (
          db
            .prepare(
              'SELECT COUNT(*) as count FROM document_chunks_fts WHERE document_chunks_fts MATCH ?',
            )
            .get(probe) as { count: number }
        ).count;
        if (hits === 0) {
          db.exec("INSERT INTO document_chunks_fts(document_chunks_fts) VALUES('rebuild')");
          console.log(`[migration] rebuilt FTS index (probe "${probe}" had 0 hits)`);
        }
      }
    }
  } catch (err) {
    // FTS table não existe (não rodou schema?) ou outro problema. Não bloqueia.
    console.warn('[migration] FTS backfill skipped:', err instanceof Error ? err.message : err);
  }
}

/**
 * Wrapper Drizzle sobre a mesma conexão `better-sqlite3` (v0.7.3+).
 *
 * Coexiste com `getDb()` durante a migração. Repositórios novos usam
 * `getDrizzleDb()`; queries que precisam de SQL raw (FTS5 MATCH, PRAGMA)
 * continuam usando `getDb()` direto.
 *
 * Mesma instância subjacente — sem dupla conexão. Drizzle só wrappa.
 */
export function getDrizzleDb(): BetterSQLite3Database<typeof drizzleSchema> {
  if (drizzleInstance) return drizzleInstance;
  const sqlite = getDb();
  drizzleInstance = drizzle(sqlite, { schema: drizzleSchema });
  return drizzleInstance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
    drizzleInstance = null;
  }
}
