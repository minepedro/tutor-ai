/*
  Script de inspeção do database.db. Lê o SQLite usando o módulo `node:sqlite`
  (built-in no Node 22+, estável no 24) — não precisa do better-sqlite3, que
  está compilado contra os headers do Electron e não roda em Node puro.

  Uso: npx tsx scripts/inspect-db.ts
*/
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const dbPath = join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'tutor-ai',
  'database.db',
);

if (!existsSync(dbPath)) {
  console.error(`Database não encontrado em ${dbPath}`);
  process.exit(1);
}

console.log(`📂 ${dbPath}\n`);
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('=== SUBJECTS ===');
const subjects = db.prepare('SELECT id, name, emoji FROM subjects').all();
console.table(subjects);

console.log('\n=== TOPICS (com nome do subject) ===');
const topics = db
  .prepare(
    `SELECT t.id, t.name as topic, s.name as subject
     FROM topics t JOIN subjects s ON s.id = t.subject_id`,
  )
  .all();
console.table(topics);

console.log('\n=== SOURCES (filename + topic + content_hash truncado) ===');
const sources = db
  .prepare(
    `SELECT
        s.id,
        s.filename,
        t.name as topic,
        substr(s.content_hash, 1, 12) || '...' as hash,
        s.raw_text IS NOT NULL as processed
     FROM sources s
     JOIN topics t ON t.id = s.topic_id`,
  )
  .all();
console.table(sources);

console.log('\n=== CHUNKS POR SOURCE ===');
const chunkCounts = db
  .prepare(
    `SELECT
        substr(s.id, 1, 8) || '...' as source_id,
        s.filename,
        t.name as topic,
        COUNT(c.id) as chunks
     FROM sources s
     JOIN topics t ON t.id = s.topic_id
     LEFT JOIN document_chunks c ON c.source_id = s.id
     GROUP BY s.id
     ORDER BY t.name`,
  )
  .all();
console.table(chunkCounts);

console.log('\n=== AGRUPADO POR HASH (mesmo arquivo, múltiplos topics?) ===');
const byHash = db
  .prepare(
    `SELECT
        substr(content_hash, 1, 12) || '...' as hash,
        filename,
        COUNT(*) as source_rows,
        GROUP_CONCAT(DISTINCT topic_id) as topic_ids
     FROM sources
     GROUP BY content_hash
     HAVING COUNT(*) > 1`,
  )
  .all();
if (byHash.length === 0) {
  console.log('Nenhum arquivo aparece em mais de 1 source.');
} else {
  console.table(byHash);
}

db.close();
