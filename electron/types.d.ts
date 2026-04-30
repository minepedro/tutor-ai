// Permite importar qualquer arquivo .sql como string usando o sufixo ?raw do Vite.
// Ex: import schema from './schema.sql?raw'  →  schema é uma string com o conteúdo SQL.
declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
