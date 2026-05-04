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
// ───────── Escopo: subject "gfdgd" (Toyota + Realismo + Pesquisa) ─────────────
// Mistura de domínios = teste mais robusto. ~1986 chunks ao todo.
const SUBJECT_ID = 'af4e0553-47ae-4d0e-9a8b-fea29b095b31';
const TOP_K = 5;
const RRF_K = 60;

// 25 queries variadas cobrindo: termos técnicos, paráfrases, nomes próprios,
// queries vagas, estruturais, em inglês, em PT, curtas e longas.
const QUERIES: Array<{ q: string; tag: string }> = [
  // ── Domínio 1: Toyota / Lean (técnico) ──────────────────────────────────
  { q: 'Poka Yoke', tag: 'termo técnico literal' },
  { q: 'como evitar erros na linha de produção', tag: 'paráfrase conceitual' },
  { q: 'Sistema Toyota de Produção', tag: 'termo composto comum' },
  { q: 'Taiichi Ohno', tag: 'nome próprio raro' },
  { q: 'kaizen', tag: 'termo único japonês' },
  { q: 'lean manufacturing', tag: 'termo em inglês' },
  { q: 'balanceamento de linha de montagem', tag: 'termo composto técnico' },
  { q: 'sete tipos de desperdício', tag: 'enumeração' },
  { q: 'qual a diferença entre produtividade e eficiência', tag: 'pergunta conceitual' },
  // ── Domínio 2: Pesquisa de Mercado ──────────────────────────────────────
  { q: 'como criar um questionário', tag: 'pergunta procedural' },
  { q: 'amostragem probabilística', tag: 'termo técnico estatístico' },
  // ── Domínio 3: Realismo (livro literário) ───────────────────────────────
  { q: 'naturalismo', tag: 'escola literária' },
  { q: 'Eça de Queirós', tag: 'nome próprio autor' },
  { q: 'crítica social na literatura', tag: 'conceito amplo' },
  { q: 'personagem feminina', tag: 'análise narrativa' },
  { q: 'século XIX', tag: 'marco temporal' },
  { q: 'Machado de Assis', tag: 'nome próprio brasileiro' },
  { q: 'Zola', tag: 'só sobrenome' },
  { q: 'narrador onisciente', tag: 'teoria literária' },
  { q: 'descrição da paisagem urbana', tag: 'descrição literária' },
  // ── Edge cases ──────────────────────────────────────────────────────────
  { q: 'exercício 1', tag: 'estrutural numerado' },
  { q: 'introdução', tag: 'palavra muito comum' },
  { q: 'como funciona', tag: 'query vaga' },
  { q: 'qual o tema principal', tag: 'pergunta aberta' },
  { q: 'PHP', tag: 'OFF-TOPIC (controle negativo)' },
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

// Resolve subject → topics → sources (escopo mais largo)
const sourceRows = db
  .prepare(
    `SELECT s.id, s.filename
     FROM sources s
     JOIN topics t ON t.id = s.topic_id
     WHERE t.subject_id = ?`,
  )
  .all(SUBJECT_ID) as unknown as Array<{ id: string; filename: string }>;
const sourceIds = sourceRows.map((s) => s.id);
const filenameById = new Map(sourceRows.map((s) => [s.id, s.filename]));

console.log(`📂 Subject tem ${sourceIds.length} sources`);

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

// Warm-up: primeira chamada paga overhead de carregamento do modelo. Não conta.
await embed('warm up');

interface QueryStats {
  q: string;
  tag: string;
  semLatencyMs: number;
  ftsLatencyMs: number;
  hybLatencyMs: number;
  semSources: number;
  ftsSources: number;
  hybSources: number;
  overlap: number;
  semHasFtsTop1: number; // -1 se não tem; senão a posição em sem
  hybTop1Origin: 'sem-only' | 'fts-only' | 'both';
  semTop1Distance: number | null;
  ftsCount: number; // quantos resultados o FTS conseguiu retornar
}

const stats: QueryStats[] = [];
let report = `# RAG Comparison — Semantic vs FTS vs Hybrid RRF\n\n`;
report += `**Escopo:** subject \`${SUBJECT_ID.slice(0, 8)}…\` — ${sourceIds.length} sources, ${vectors.length} chunks\n\n`;
report += `**Queries:** ${QUERIES.length}  ·  **Top K:** ${TOP_K}  ·  **RRF_K:** ${RRF_K}\n\n---\n\n`;

for (const { q, tag } of QUERIES) {
  console.log(`▶ ${q}`);

  const t0 = performance.now();
  const sem = await semanticSearch(q, TOP_K);
  const t1 = performance.now();
  const fts = ftsSearch(q, TOP_K);
  const t2 = performance.now();
  const hyb = rrf(sem, fts, TOP_K);
  const t3 = performance.now();

  const semIds = new Set(sem.map((s) => s.id));
  const ftsIds = new Set(fts.map((f) => f.id));
  const overlap = [...semIds].filter((id) => ftsIds.has(id)).length;

  const ftsTop1Id = fts[0]?.id;
  const semHasFtsTop1 = ftsTop1Id
    ? sem.findIndex((s) => s.id === ftsTop1Id)
    : -1;

  const hybTop1Id = hyb[0]?.item.id;
  const hybTop1Origin: QueryStats['hybTop1Origin'] = !hybTop1Id
    ? 'sem-only'
    : semIds.has(hybTop1Id) && ftsIds.has(hybTop1Id)
      ? 'both'
      : ftsIds.has(hybTop1Id)
        ? 'fts-only'
        : 'sem-only';

  stats.push({
    q,
    tag,
    semLatencyMs: t1 - t0,
    ftsLatencyMs: t2 - t1,
    hybLatencyMs: t3 - t0,
    semSources: new Set(sem.map((s) => s.source_id)).size,
    ftsSources: new Set(fts.map((s) => s.source_id)).size,
    hybSources: new Set(hyb.map((s) => s.item.source_id)).size,
    overlap,
    semHasFtsTop1,
    hybTop1Origin,
    semTop1Distance: sem[0]?.distance ?? null,
    ftsCount: fts.length,
  });

  report += `## "${q}"\n\n`;
  report += `**Tipo:** ${tag}  ·  **Latência:** sem ${(t1 - t0).toFixed(0)}ms · fts ${(t2 - t1).toFixed(1)}ms\n\n`;
  report += `### Semantic only\n`;
  if (sem.length === 0) report += `_sem resultados_\n\n`;
  for (const [i, r] of sem.entries()) {
    report += `${i + 1}. **${shortFile(r.source_id)}** · dist=${r.distance.toFixed(3)}\n   > ${snippet(r.content)}\n`;
  }
  report += `\n### FTS only\n`;
  if (fts.length === 0) report += `_sem resultados_\n\n`;
  for (const [i, r] of fts.entries()) {
    report += `${i + 1}. **${shortFile(r.source_id)}** · bm25=${r.fts_rank.toFixed(2)}\n   > ${snippet(r.content)}\n`;
  }
  report += `\n### Hybrid RRF\n`;
  for (const [i, r] of hyb.entries()) {
    const inSem = semIds.has(r.item.id);
    const inFts = ftsIds.has(r.item.id);
    const origin = inSem && inFts ? '🟢 both' : inFts ? '🔵 fts-only' : '🟡 sem-only';
    report += `${i + 1}. **${shortFile(r.item.source_id)}** · rrf=${r.score.toFixed(4)} · ${origin}\n   > ${snippet(r.item.content)}\n`;
  }
  report += `\n**Overlap @${TOP_K}:** ${overlap}/${TOP_K}  ·  **FTS top-1 in sem:** ${semHasFtsTop1 === -1 ? 'não está' : `posição ${semHasFtsTop1 + 1}`}  ·  **Hybrid top-1 origin:** ${hybTop1Origin}\n\n---\n\n`;
}

// ───── Resumo agregado ───────────────────────────────────────────────────
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
report += `## Resumo agregado\n\n`;
report += `### Latência (média sobre ${QUERIES.length} queries)\n\n`;
report += `| Estratégia | Média (ms) | p50 (ms) |\n`;
report += `|------------|------------|----------|\n`;
const sortedSem = [...stats].map((s) => s.semLatencyMs).sort((a, b) => a - b);
const sortedFts = [...stats].map((s) => s.ftsLatencyMs).sort((a, b) => a - b);
const sortedHyb = [...stats].map((s) => s.hybLatencyMs).sort((a, b) => a - b);
report += `| Semantic | ${avg(stats.map((s) => s.semLatencyMs)).toFixed(1)} | ${sortedSem[Math.floor(sortedSem.length / 2)]?.toFixed(1)} |\n`;
report += `| FTS      | ${avg(stats.map((s) => s.ftsLatencyMs)).toFixed(1)} | ${sortedFts[Math.floor(sortedFts.length / 2)]?.toFixed(1)} |\n`;
report += `| Hybrid   | ${avg(stats.map((s) => s.hybLatencyMs)).toFixed(1)} | ${sortedHyb[Math.floor(sortedHyb.length / 2)]?.toFixed(1)} |\n\n`;

const overlapDist = stats.reduce<Record<number, number>>((acc, s) => {
  acc[s.overlap] = (acc[s.overlap] ?? 0) + 1;
  return acc;
}, {});
report += `### Distribuição do overlap (semantic ∩ fts) @${TOP_K}\n\n`;
report += `| Overlap | # queries |\n|---|---|\n`;
for (let i = 0; i <= TOP_K; i++) {
  report += `| ${i}/${TOP_K} | ${overlapDist[i] ?? 0} |\n`;
}
report += `\n*overlap = quantos chunks aparecem nos dois top-${TOP_K}. Baixo overlap = engines vendo coisas diferentes (RRF agrega valor). Alto = engines redundantes.*\n\n`;

const hybOriginCount = stats.reduce<Record<string, number>>((acc, s) => {
  acc[s.hybTop1Origin] = (acc[s.hybTop1Origin] ?? 0) + 1;
  return acc;
}, {});
report += `### Origem do top-1 do híbrido\n\n`;
report += `| Origem | # queries | Significado |\n|---|---|---|\n`;
report += `| both | ${hybOriginCount['both'] ?? 0} | top-1 está em ambos rankings (consenso) |\n`;
report += `| sem-only | ${hybOriginCount['sem-only'] ?? 0} | semantic empurrou — semantic suficiente |\n`;
report += `| fts-only | ${hybOriginCount['fts-only'] ?? 0} | FTS empurrou — sem FTS, top-1 era diferente |\n\n`;

const ftsZero = stats.filter((s) => s.ftsCount === 0).length;
report += `### Robustez\n\n`;
report += `- Queries onde FTS retornou 0 resultados: **${ftsZero}/${QUERIES.length}**\n`;
report += `- Queries onde FTS top-1 NÃO estava no top-${TOP_K} do semantic: **${stats.filter((s) => s.ftsCount > 0 && s.semHasFtsTop1 === -1).length}/${QUERIES.length}**\n`;
report += `  *(estes são os casos onde FTS adicionou valor real ao top-K)*\n\n`;
report += `### Diversidade de sources no top-${TOP_K}\n\n`;
report += `| Estratégia | Média de sources únicos |\n|---|---|\n`;
report += `| Semantic | ${avg(stats.map((s) => s.semSources)).toFixed(2)} |\n`;
report += `| FTS      | ${avg(stats.map((s) => s.ftsSources)).toFixed(2)} |\n`;
report += `| Hybrid   | ${avg(stats.map((s) => s.hybSources)).toFixed(2)} |\n\n`;

const reportPath = join(__dirname, 'compare-rag.report.md');
writeFileSync(reportPath, report, 'utf8');
console.log(`\n✅ Relatório salvo em ${reportPath}`);

db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
