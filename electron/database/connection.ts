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

  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
