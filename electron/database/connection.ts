import Database from 'better-sqlite3';
import { app } from 'electron';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import schema from './schema.sql?raw';

/*
  💡 Singleton pattern: uma única instância do banco compartilhada por todo o
  processo main. A variável `instance` guarda a conexão aberta; nas chamadas
  seguintes `getDb()` retorna ela sem reabrir o arquivo.
*/
let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;

  const userDataPath = app.getPath('userData');

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
  // é idempotente (checa se já foi aplicada). Não temos sistema completo de
  // migrations ainda — quando virar dor (>3 migrations), trocar por umzug.
  applyMigrations(instance);

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
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
