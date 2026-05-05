import { defineConfig } from 'drizzle-kit';

/*
  Config do drizzle-kit (CLI pra gerar migrations e validar schema).

  Driver: better-sqlite3 (mesmo que o app usa). Não usa connection real —
  drizzle-kit lê do schema.ts e gera SQL puro nas migrations.

  `dbCredentials` é exigido pela CLI mas o path é só usado em comandos como
  `drizzle-kit studio` (GUI). Migrations geradas são SQL puro — não dependem
  de conexão real.
*/
export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/database/drizzle/schema.ts',
  out: './electron/database/migrations',
  dbCredentials: {
    // Path nominal pra CLI funcionar — não é usado em produção.
    url: './scripts/.drizzle-cli.db',
  },
  verbose: true,
  strict: true,
});
