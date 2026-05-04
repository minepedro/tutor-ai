/*
  Compara 3 estratégias de retrieval lado a lado pra um conjunto de queries:
    1. Semantic-only (v0.5 baseline) — só cosine distance
    2. FTS-only — só BM25 do SQLite FTS5
    3. Hybrid RRF (v0.6) — fusão dos dois via Reciprocal Rank Fusion

  Output: scripts/compare-rag.report.md

  Uso: npx tsx scripts/compare-rag.ts
*/
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import * as lancedb from '@lancedb/lancedb';

// ───────── Setup paths (replicar app.getPath('userData') no Windows) ──────────
const userDataPath = join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'tutor-ai',
);
const dbPath = join(userDataPath, 'database.db');
const lanceDbPath = join(userDataPath, 'embeddings');
const modelPath = join(userDataPath, 'models', 'all-MiniLM-L6-v2.onnx');

if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
if (!existsSync(modelPath)) throw new Error(`Modelo ONNX não encontrado: ${modelPath}`);

async function main() {
// ───────── Tópico de teste: "fdsfs" (Sistema Toyota de Produção) ──────────────
const TOPIC_ID = '556768bd-a6cb-402a-a93e-dff40be6c705';
const TOP_K = 5;
const RRF_K = 60;

// Queries de teste — mistura proposital de tipos pra exercitar cada engine
const QUERIES: Array<{ q: string; tag: string; expectation: string }> = [
  {
    q: 'Poka Yoke',
    tag: 'TERMO TÉCNICO LITERAL',
    expectation: 'FTS deveria dominar (palavra rara, citação literal)',
  },
  {
    q: 'como evitar erros na linha de produção',
    tag: 'PARAFRASEADO (semântico)',
    expectation: 'Semantic deveria dominar (deve mapear pra Poka Yoke sem citar)',
  },
  {
    q: 'kanban e just in time',
    tag: 'TERMOS COMPOSTOS TÉCNICOS',
    expectation: 'Híbrido: FTS pega kanban literal; semantic pega contexto STP',
  },
  {
    q: 'qual a diferença entre produtividade e eficiência',
    tag: 'PERGUNTA CONCEITUAL',
    expectation: 'Semantic deveria achar a aula de Produtividade',
  },
  {
    q: 'Taiichi Ohno',
    tag: 'NOME PRÓPRIO RARO',
    expectation: 'FTS deveria achar; semantic pode diluir',
  },
  {
    q: 'sistema toyota de produção',
    tag: 'TERMO MÚLTIPLO',
    expectation: 'Os dois deveriam achar — bom controle',
  },
];

// ───────── DB + LanceDB ───────────────────────────────────────────────────────
// Read-write: precisamos criar e popular a FTS5 table caso ainda não exista
// (DB criado em <v0.6 não tem). Mesmo backfill do `applyMigrations` em prod.
const db = new DatabaseSync(dbPath);

// Bootstrap FTS5 table + triggers + backfill (idempotente)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
    content, content=document_chunks, content_rowid=rowid,
    tokenize='unicode61 remove_diacritics 1'
  );
`);
const ftsCount = (
  db.prepare('SELECT COUNT(*) as count FROM document_chunks_fts').get() as { count: number }
).count;
const chunksCount = (
  db.prepare('SELECT COUNT(*) as count FROM document_chunks').get() as { count: number }
).count;
if (chunksCount > 0 && ftsCount === 0) {
  console.log(`🔧 Backfill FTS: ${chunksCount} chunks`);
  db.exec(
    `INSERT INTO document_chunks_fts(rowid, content)
     SELECT rowid, content FROM document_chunks`,
  );
}

const sourceRows = db
  .prepare(`SELECT id, filename FROM sources WHERE topic_id = ?`)
  .all(TOPIC_ID) as Array<{ id: string; filename: string }>;
const sourceIds = sourceRows.map((s) => s.id);
const filenameById = new Map(sourceRows.map((s) => [s.id, s.filename]));

console.log(`📂 Tópico tem ${sourceIds.length} sources`);

const lance = await lancedb.connect(lanceDbPath);
const chunksTable = await lance.openTable('chunks');

interface VectorRecord {
  id: string;
  source_id: string;
  vector: number[];
}

// Carrega TODOS os vetores das sources do escopo
const allVectorsRaw = await chunksTable.query().toArray();
const vectors: VectorRecord[] = allVectorsRaw
  .filter((r) => sourceIds.includes(r['source_id']))
  .map((r) => ({
    id: r['id'],
    source_id: r['source_id'],
    vector: Array.from(r['vector']),
  }));

console.log(`📐 ${vectors.length} vetores carregados pro escopo`);

// ───────── Embedding (ONNX + xenova tokenizer) ────────────────────────────────
const transformers = await import('@xenova/transformers');
transformers.env.cacheDir = join(userDataPath, 'models', 'transformers-cache');
transformers.env.allowLocalModels = false;
const tokenizer = await transformers.AutoTokenizer.from_pretrained(
  'Xenova/all-MiniLM-L6-v2',
);
const session = await ort.InferenceSession.create(modelPath, {
  executionProviders: ['cpu'],
});

async function embed(text: string): Promise<number[]> {
  const encoded = await tokenizer(text, { padding: true, truncation: true, max_length: 256 });
  const inputIds = encoded.input_ids.data as BigInt64Array;
  const attentionMask = encoded.attention_mask.data as BigInt64Array;
  const seqLen = encoded.input_ids.dims[1] ?? inputIds.length;
  const tokenTypeIds = new BigInt64Array(seqLen).fill(0n);

  const results = await session.run({
    input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
  });
  const hidden = results['last_hidden_state']!.data as Float32Array;

  // mean pool ignorando padding
  const result = new Float32Array(384);
  let n = 0;
  for (let i = 0; i < seqLen; i++) {
    if (Number(attentionMask[i] ?? 0n) === 0) continue;
    n++;
    for (let j = 0; j < 384; j++) {
      result[j] = (result[j] ?? 0) + (hidden[i * 384 + j] ?? 0);
    }
  }
  for (let j = 0; j < 384; j++) result[j] = (result[j] ?? 0) / Math.max(n, 1);
  return Array.from(result);
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0, bv = b[i] ?? 0;
    dot += av * bv; magA += av * av; magB += bv * bv;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 1 : 1 - dot / denom;
}

// ───────── Helpers de busca ───────────────────────────────────────────────────
interface ChunkInfo {
  id: string;
  source_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
}

function getChunkInfos(ids: string[]): Map<string, ChunkInfo> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, source_id, content, page_number, chunk_index
       FROM document_chunks WHERE id IN (${placeholders})`,
    )
    .all(...ids) as unknown as ChunkInfo[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function semanticSearch(query: string, k: number) {
  const qVec = await embed(query);
  const scored = vectors
    .map((v) => ({ id: v.id, distance: cosineDistance(qVec, v.vector) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
  const infos = getChunkInfos(scored.map((s) => s.id));
  return scored.map((s, i) => ({ ...infos.get(s.id)!, distance: s.distance, rank: i }));
}

function ftsSearch(query: string, k: number) {
  const words = query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (words.length === 0) return [];
  const ftsQuery = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' OR ');
  const placeholders = sourceIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT c.id, c.source_id, c.content, c.page_number, c.chunk_index,
              bm25(document_chunks_fts) as fts_rank
       FROM document_chunks c
       JOIN document_chunks_fts fts ON c.rowid = fts.rowid
       WHERE document_chunks_fts MATCH ?
         AND c.source_id IN (${placeholders})
       ORDER BY fts_rank LIMIT ?`,
    )
    .all(ftsQuery, ...sourceIds, k) as unknown as Array<ChunkInfo & { fts_rank: number }>;
  return rows.map((r, i) => ({ ...r, rank: i }));
}

function rrf<A extends { id: string; rank: number }, B extends { id: string; rank: number }>(
  semantic: A[],
  fts: B[],
  k: number,
) {
  const scores = new Map<string, { item: A | B; score: number }>();
  for (const s of semantic) {
    scores.set(s.id, { item: s, score: 1 / (RRF_K + s.rank) });
  }
  for (const f of fts) {
    const ex = scores.get(f.id);
    if (ex) ex.score += 1 / (RRF_K + f.rank);
    else scores.set(f.id, { item: f, score: 1 / (RRF_K + f.rank) });
  }
  return Array.from(scores.values()).sort((a, b) => b.score - a.score).slice(0, k);
}

// ───────── Render do markdown ─────────────────────────────────────────────────
function shortFile(srcId: string): string {
  const f = filenameById.get(srcId) ?? '?';
  return f.replace('.pdf', '').slice(0, 50);
}
function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 100).trim();
}

let report = `# RAG Comparison — v0.5 (semantic) vs v0.6 (hybrid RRF)\n\n`;
report += `**Tópico:** Sistema Toyota de Produção (${sourceIds.length} sources, ${vectors.length} chunks)\n\n`;
report += `**Top K:** ${TOP_K}  ·  **RRF_K:** ${RRF_K}\n\n---\n\n`;

for (const { q, tag, expectation } of QUERIES) {
  console.log(`▶ ${q}`);
  const sem = await semanticSearch(q, TOP_K);
  const fts = ftsSearch(q, TOP_K);
  const hyb = rrf(sem, fts, TOP_K);

  report += `## "${q}"\n\n`;
  report += `**Tipo:** ${tag}  ·  **Hipótese:** ${expectation}\n\n`;
  report += `### Semantic only (v0.5)\n`;
  if (sem.length === 0) report += `_sem resultados_\n\n`;
  for (const [i, r] of sem.entries()) {
    report += `${i + 1}. **${shortFile(r.source_id)}** (p.${r.page_number ?? '?'}) · dist=${r.distance.toFixed(3)}\n   > ${snippet(r.content)}\n`;
  }
  report += `\n### FTS only\n`;
  if (fts.length === 0) report += `_sem resultados_\n\n`;
  for (const [i, r] of fts.entries()) {
    report += `${i + 1}. **${shortFile(r.source_id)}** (p.${r.page_number ?? '?'}) · bm25=${r.fts_rank.toFixed(2)}\n   > ${snippet(r.content)}\n`;
  }
  report += `\n### Hybrid RRF (v0.6)\n`;
  for (const [i, r] of hyb.entries()) {
    report += `${i + 1}. **${shortFile(r.item.source_id)}** (p.${r.item.page_number ?? '?'}) · rrf=${r.score.toFixed(4)}\n   > ${snippet(r.item.content)}\n`;
  }

  // Análise: quantos chunks FTS adicionou que o semantic não tinha
  const semIds = new Set(sem.map((s) => s.id));
  const ftsIds = new Set(fts.map((f) => f.id));
  const onlyFts = [...ftsIds].filter((id) => !semIds.has(id));
  const onlySem = [...semIds].filter((id) => !ftsIds.has(id));
  const overlap = [...semIds].filter((id) => ftsIds.has(id));
  report += `\n**Análise:** overlap=${overlap.length}/${TOP_K}  ·  só-semantic=${onlySem.length}  ·  só-fts=${onlyFts.length}\n\n---\n\n`;
}

const reportPath = join(__dirname, 'compare-rag.report.md');
writeFileSync(reportPath, report, 'utf8');
console.log(`\n✅ Relatório salvo em ${reportPath}`);

db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
