/*
  Compara pipelines V2: testa abordagens SEM K-means + uma com cobertura forçada por source.
  - NEW (referência, K-means + embeddings)
  - TFIDF_PURE: ranqueia conceitos por TF-IDF score (top-N), 1 pergunta por conceito top
  - BERT_PURE: ranqueia conceitos por similaridade ao centroide do corpus (top-N)
  - SOURCE_RR: round-robin por source (garante 1+ pergunta por PDF se possível)

  CLI:
    --topic-id=<uuid>   default: scdsxzadsa (mix)
    --count=<N>         default: 10
    --suffix=<str>      default: v2

  Custo: ~$0.40-0.60 por rodada (4 pipelines × 1 chamada Claude cada).
*/
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import Anthropic from '@anthropic-ai/sdk';

const userDataPath = join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'tutor-ai',
);
const dbPath = join(userDataPath, 'database.db');
const modelPath = join(userDataPath, 'models', 'all-MiniLM-L6-v2.onnx');

if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
if (!existsSync(modelPath)) throw new Error(`Modelo ONNX não encontrado.`);

function getArg(name: string, def: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] ?? def : def;
}
const TOPIC_ID = getArg('topic-id', '4f3c5439-0e95-454a-a52a-750d96441ca4');
const QUESTION_COUNT = parseInt(getArg('count', '10'), 10);
const REPORT_SUFFIX = getArg('suffix', 'v2');
const SONNET_MODEL = 'claude-sonnet-4-6';

async function main() {

const apiKey = process.env['ANTHROPIC_API_KEY'];
if (!apiKey) throw new Error('Sem ANTHROPIC_API_KEY na env.');
const anthropic = new Anthropic({ apiKey });

// ───────── DB ─────────────────────────────────────────────────────────────
const db = new DatabaseSync(dbPath, { readOnly: false });
interface SourceRow {
  id: string;
  filename: string;
  raw_text: string | null;
  extracted_concepts: string | null;
}
const sources = db
  .prepare(
    `SELECT id, filename, raw_text, extracted_concepts
     FROM sources WHERE topic_id = ? AND raw_text IS NOT NULL`,
  )
  .all(TOPIC_ID) as unknown as SourceRow[];

if (sources.length === 0) throw new Error('Nenhuma source nesse tópico.');
console.log(`📂 ${sources.length} sources processados:`);
sources.forEach((s) => console.log(`  • ${s.filename}`));

// ───────── ONNX embedding setup ───────────────────────────────────────────
const transformers = await import('@xenova/transformers');
transformers.env.cacheDir = join(userDataPath, 'models', 'transformers-cache');
transformers.env.allowLocalModels = false;
const tokenizer = await transformers.AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
const ortSession = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });

async function embed(text: string): Promise<number[]> {
  const encoded = await tokenizer(text, { padding: true, truncation: true, max_length: 256 });
  const inputIds = encoded.input_ids.data as BigInt64Array;
  const attentionMask = encoded.attention_mask.data as BigInt64Array;
  const seqLen = encoded.input_ids.dims[1] ?? inputIds.length;
  const tokenTypeIds = new BigInt64Array(seqLen).fill(0n);
  const r = await ortSession.run({
    input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
  });
  const hidden = r['last_hidden_state']!.data as Float32Array;
  const result = new Float32Array(384);
  let n = 0;
  for (let i = 0; i < seqLen; i++) {
    if (Number(attentionMask[i] ?? 0n) === 0) continue;
    n++;
    for (let j = 0; j < 384; j++) result[j] = (result[j] ?? 0) + (hidden[i * 384 + j] ?? 0);
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

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

// ───────── TF-IDF ─────────────────────────────────────────────────────────
const STOPWORDS_PT = new Set([
  'que', 'para', 'com', 'por', 'das', 'dos', 'mais', 'sua', 'seu', 'esta',
  'este', 'isso', 'isto', 'são', 'foi', 'ser', 'ter', 'tem', 'pelo', 'pela',
  'numa', 'num', 'aos', 'mas', 'também', 'como', 'quando', 'onde', 'porque',
  'então', 'depois', 'ainda', 'sem', 'sobre', 'entre', 'estão', 'pode',
  'faz', 'fez', 'sim', 'não', 'todo', 'toda', 'todos', 'todas', 'cada',
]);
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 3);
}
function tfidfVectors(docs: string[]): { vectors: number[][]; vocab: Map<string, number>; idf: number[] } {
  const allTokens = docs.map(tokenize);
  const vocab = new Map<string, number>();
  for (const tokens of allTokens) for (const t of tokens) {
    if (STOPWORDS_PT.has(t)) continue;
    if (!vocab.has(t)) vocab.set(t, vocab.size);
  }
  const V = vocab.size, N = docs.length;
  const df = new Array<number>(V).fill(0);
  for (const tokens of allTokens) {
    const seen = new Set<string>();
    for (const t of tokens) if (vocab.has(t) && !seen.has(t)) {
      df[vocab.get(t)!] = (df[vocab.get(t)!] ?? 0) + 1;
      seen.add(t);
    }
  }
  const idf = df.map((d) => Math.log((N + 1) / (d + 1)) + 1);
  const vectors = allTokens.map((tokens) => {
    const tf = new Array<number>(V).fill(0);
    for (const t of tokens) if (vocab.has(t)) tf[vocab.get(t)!] = (tf[vocab.get(t)!] ?? 0) + 1;
    const total = tokens.length || 1;
    return tf.map((c, i) => (c / total) * (idf[i] ?? 0));
  });
  return { vectors, vocab, idf };
}

// ───────── Análise Claude ─────────────────────────────────────────────────
interface ExtractedConcept {
  name: string;
  definition: string;
  importance: 'core' | 'supporting';
  related?: string[];
}
interface ConceptWithSource extends ExtractedConcept {
  sourceId: string;
  sourceFilename: string;
}

let claudeIn = 0, claudeOut = 0;

async function analyzeOnce(source: SourceRow): Promise<ExtractedConcept[]> {
  if (source.extracted_concepts) {
    try {
      const cached = JSON.parse(source.extracted_concepts) as { concepts?: ExtractedConcept[] };
      if (cached.concepts) return cached.concepts;
    } catch {}
  }
  const sys = `Você é um analista de material de estudo. Extraia conceitos centrais.
REGRAS: ignore metadados, foque em conceitos/definições/fórmulas, diferencie core/supporting.
FORMATO: APENAS JSON: { "concepts": [{ "name": "...", "definition": "...", "importance": "core"|"supporting", "related": [] }] }`;
  const text = (source.raw_text ?? '').slice(0, 50_000);
  const r = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4096, temperature: 0.3, system: sys,
    messages: [{ role: 'user', content: `Material:\n\n${text}` }],
  });
  claudeIn += r.usage.input_tokens; claudeOut += r.usage.output_tokens;
  const block = r.content.find((b) => b.type === 'text');
  const raw = block?.type === 'text' ? block.text : '';
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const p = JSON.parse(m[0]) as { concepts?: ExtractedConcept[] };
    return p.concepts ?? [];
  } catch { return []; }
}

interface GeneratedQ {
  type: string; difficulty: string; question: string; options: string[];
  correctIndex: number; explanation: string; conceptsRef?: string[];
}

async function generateFromPrompt(systemPrompt: string, userPrompt: string, count: number): Promise<GeneratedQ[]> {
  const maxTokens = Math.min(700 * count + 2000, 8192);
  const r = await anthropic.messages.create({
    model: SONNET_MODEL, max_tokens: maxTokens, temperature: 0.7,
    system: systemPrompt, messages: [{ role: 'user', content: userPrompt }],
  });
  claudeIn += r.usage.input_tokens; claudeOut += r.usage.output_tokens;
  const block = r.content.find((b) => b.type === 'text');
  const raw = block?.type === 'text' ? block.text : '';
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as Array<{
      type?: string; difficulty?: string; question?: string; options?: string[];
      correct_index?: number; explanation?: string; concepts_ref?: string[];
    }>;
    return arr
      .filter((q) => q.question && Array.isArray(q.options))
      .map((q) => ({
        type: q.type ?? 'multiple_choice', difficulty: q.difficulty ?? 'medium',
        question: q.question!, options: q.options!,
        correctIndex: q.correct_index ?? 0, explanation: q.explanation ?? '',
        conceptsRef: q.concepts_ref ?? [],
      }));
  } catch { return []; }
}

// ───────── K-means (compartilhado pra NEW) ────────────────────────────────
function kmeans(vectors: number[][], k: number): number[] {
  const n = vectors.length;
  if (n <= k) return vectors.map((_, i) => i);
  const centroidIdxs: number[] = [Math.floor(Math.random() * n)];
  for (let c = 1; c < k; c++) {
    const dists = vectors.map((v) => {
      let min = Infinity;
      for (const ci of centroidIdxs) {
        const d = cosineDistance(v, vectors[ci]!);
        if (d < min) min = d;
      }
      return min * min;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    if (total === 0) break;
    let r = Math.random() * total;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]!;
      if (r <= 0) { centroidIdxs.push(i); break; }
    }
  }
  let centroids = centroidIdxs.map((i) => [...vectors[i]!]);
  let assignments = new Array<number>(n).fill(-1);
  for (let iter = 0; iter < 50; iter++) {
    const newAssign = vectors.map((v) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = cosineDistance(v, centroids[i]!);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    });
    const changed = newAssign.some((a, i) => a !== assignments[i]);
    assignments = newAssign;
    if (!changed && iter > 0) break;
    for (let c = 0; c < centroids.length; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        const dim = members[0]!.length;
        const mean = new Array<number>(dim).fill(0);
        for (const m of members) for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) + (m[i] ?? 0);
        for (let i = 0; i < dim; i++) mean[i] = (mean[i] ?? 0) / members.length;
        centroids[c] = mean;
      }
    }
  }
  return assignments;
}

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINES
// ═══════════════════════════════════════════════════════════════════════════

interface PipelineResult {
  pipeline: string;
  questions: GeneratedQ[];
  setupTimeMs: number;
  generationTimeMs: number;
  conceptsUsed: ConceptWithSource[];
}

// ── PIPELINE NEW (referência: K-means + embeddings) ──────────────────────
async function pipelineNew(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const k = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(allConcepts.length))));
  const vecs = await Promise.all(allConcepts.map((c) => embed(`${c.name}: ${c.definition}`)));
  const assignments = kmeans(vecs, k);
  const clusters: ConceptWithSource[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < allConcepts.length; i++) clusters[assignments[i]!]?.push(allConcepts[i]!);
  const nonEmpty = clusters.filter((c) => c.length > 0);
  shuffleInPlace(nonEmpty);
  const setupTime = performance.now() - t0;

  const baseQuota = Math.floor(QUESTION_COUNT / nonEmpty.length);
  const remainder = QUESTION_COUNT - baseQuota * nonEmpty.length;
  const text = nonEmpty.map((cluster, idx) => {
    const quota = baseQuota + (idx < remainder ? 1 : 0);
    const items = cluster.map((c) => `  - ${c.name} [${c.importance}]: ${c.definition}`).join('\n');
    return `[TEMA ${idx + 1}] ~${quota} perguntas\n${items}`;
  }).join('\n\n');

  const sys = `Você é um professor que cria quizzes. Distribua ${QUESTION_COUNT} perguntas UNIFORMEMENTE entre os temas. Distratores = misconceptions plausíveis. FORMATO: array JSON {type, difficulty, question, options[], correct_index, explanation, concepts_ref[]}.`;
  const user = `Conceitos em ${nonEmpty.length} temas:\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  return {
    pipeline: 'NEW (K-means + embeddings)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: performance.now() - t1,
    conceptsUsed: allConcepts,
  };
}

// ── PIPELINE TFIDF_PURE (ranking sem cluster) ────────────────────────────
async function pipelineTfidfPure(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const docs = allConcepts.map((c) => `${c.name} ${c.definition}`);
  const { vectors, idf } = tfidfVectors(docs);

  /*
    Score "importância" do conceito: soma dos pesos TF-IDF do vetor (norma L1).
    Conceitos com termos raros (alto IDF) e frequentes no documento (alto TF)
    sobem no ranking. É uma heurística simples — não é "centralidade" formal,
    mas funciona como proxy de "termos discriminativos do corpus".
  */
  const scored = allConcepts.map((c, i) => ({
    concept: c,
    score: (vectors[i] ?? []).reduce((s, v) => s + v, 0),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Pega top-N (1 pergunta por conceito top)
  const topN = scored.slice(0, QUESTION_COUNT);
  const setupTime = performance.now() - t0;

  const text = topN.map((s, idx) =>
    `${idx + 1}. [${s.concept.importance}] ${s.concept.name}: ${s.concept.definition}`,
  ).join('\n');

  const sys = `Você é um professor. Gere EXATAMENTE 1 pergunta para CADA conceito listado, na ordem dada. Distratores = misconceptions plausíveis. FORMATO: array JSON {type, difficulty, question, options[], correct_index, explanation, concepts_ref[]}.`;
  const user = `Conceitos top-${QUESTION_COUNT} ranqueados por TF-IDF:\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas (1 por conceito).`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);

  // Marca quais conceitos foram usados (top-N apenas)
  const usedConcepts = topN.map((s) => s.concept);

  return {
    pipeline: 'TFIDF_PURE (top-N ranking)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: performance.now() - t1,
    conceptsUsed: usedConcepts,
  };
}

// ── PIPELINE BERT_PURE (ranking por similaridade ao centroide) ───────────
async function pipelineBertPure(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const vecs = await Promise.all(allConcepts.map((c) => embed(`${c.name}: ${c.definition}`)));

  // Centroide do corpus = média de todos os vetores
  const dim = vecs[0]?.length ?? 384;
  const centroid = new Array<number>(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] ?? 0) + (v[i] ?? 0);
  for (let i = 0; i < dim; i++) centroid[i] = (centroid[i] ?? 0) / vecs.length;

  /*
    Score = SIMILARIDADE ao centroide (1 - cosine distance).
    Conceitos mais "centrais" = perto do centroide do corpus = representativos.

    💡 Variação possível: usar DISSIMILARIDADE (escolher conceitos mais
    distintos entre si). Mas pra "cobertura uniforme", centralidade é o que
    queremos: conceitos que representam o tema central de cada cluster
    natural do corpus, sem clusterizar explicitamente.
  */
  const scored = allConcepts.map((c, i) => ({
    concept: c,
    score: 1 - cosineDistance(vecs[i]!, centroid),
  }));

  /*
    Diversificação MMR-like: pega top conceito, depois escolhe próximo
    minimizando similaridade aos já escolhidos. Evita que top-N seja todos
    do mesmo "núcleo semântico".
  */
  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);
  const selected: typeof scored = [];
  const selectedIdxs = new Set<number>();
  // Primeiro: o mais central
  selected.push(sortedByScore[0]!);
  selectedIdxs.add(allConcepts.indexOf(sortedByScore[0]!.concept));

  while (selected.length < QUESTION_COUNT && selected.length < allConcepts.length) {
    let bestCand: typeof scored[number] | null = null;
    let bestMmrScore = -Infinity;
    for (const cand of scored) {
      const candIdx = allConcepts.indexOf(cand.concept);
      if (selectedIdxs.has(candIdx)) continue;
      // MMR: λ * relevance - (1-λ) * max_sim_to_selected
      const lambda = 0.5;
      const candVec = vecs[candIdx]!;
      let maxSimToSelected = 0;
      for (const sel of selected) {
        const selVec = vecs[allConcepts.indexOf(sel.concept)]!;
        const sim = 1 - cosineDistance(candVec, selVec);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmrScore = lambda * cand.score - (1 - lambda) * maxSimToSelected;
      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestCand = cand;
      }
    }
    if (!bestCand) break;
    selected.push(bestCand);
    selectedIdxs.add(allConcepts.indexOf(bestCand.concept));
  }

  const setupTime = performance.now() - t0;

  const text = selected.map((s, idx) =>
    `${idx + 1}. [${s.concept.importance}] ${s.concept.name}: ${s.concept.definition}`,
  ).join('\n');

  const sys = `Você é um professor. Gere EXATAMENTE 1 pergunta para CADA conceito listado, na ordem dada. Distratores = misconceptions plausíveis. FORMATO: array JSON {type, difficulty, question, options[], correct_index, explanation, concepts_ref[]}.`;
  const user = `Conceitos selecionados via BERT-similaridade + MMR (centralidade + diversidade):\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas (1 por conceito).`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  const usedConcepts = selected.map((s) => s.concept);

  return {
    pipeline: 'BERT_PURE (centroid + MMR)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: performance.now() - t1,
    conceptsUsed: usedConcepts,
  };
}

// ── PIPELINE SOURCE_RR (round-robin por source) ──────────────────────────
async function pipelineSourceRR(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();

  // Agrupa conceitos por source
  const bySource = new Map<string, ConceptWithSource[]>();
  for (const c of allConcepts) {
    if (!bySource.has(c.sourceFilename)) bySource.set(c.sourceFilename, []);
    bySource.get(c.sourceFilename)!.push(c);
  }
  const sourceNames = Array.from(bySource.keys());
  shuffleInPlace(sourceNames);

  /*
    Quota por source: garante COBERTURA UNIFORME entre PDFs.
    - count >= numSources: cada source ganha pelo menos floor(count/numSources) perguntas
    - count < numSources: alguns sources ficam de fora (round-robin pega os primeiros)

    Ex: 5 sources × count=10 → 2 perguntas por source
    Ex: 9 sources × count=10 → 1 por source + 1 source ganha 2
    Ex: 9 sources × count=5  → 5 sources ganham 1, 4 ficam de fora (warning)
  */
  const baseQuotaPerSource = Math.floor(QUESTION_COUNT / sourceNames.length);
  const remainder = QUESTION_COUNT - baseQuotaPerSource * sourceNames.length;

  // Pra cada source, prioriza conceitos "core" e pega N
  const conceptsBlock = sourceNames.map((src, idx) => {
    const quota = baseQuotaPerSource + (idx < remainder ? 1 : 0);
    if (quota === 0) return null;
    const concepts = (bySource.get(src) ?? []).sort((a, b) => {
      // core antes de supporting
      if (a.importance === b.importance) return 0;
      return a.importance === 'core' ? -1 : 1;
    });
    const items = concepts.slice(0, Math.max(quota * 3, 5))  // 3× quota pra modelo escolher
      .map((c) => `  - ${c.name} [${c.importance}]: ${c.definition}`).join('\n');
    return `[SOURCE: ${src}] EXATAMENTE ${quota} ${quota === 1 ? 'pergunta' : 'perguntas'}\n${items}`;
  }).filter(Boolean).join('\n\n');

  const setupTime = performance.now() - t0;

  const sys = `Você é um professor. Cada SOURCE listado tem uma quota EXATA de perguntas. Você DEVE gerar exatamente o número solicitado por source. Priorize conceitos "core". Distratores = misconceptions plausíveis. FORMATO: array JSON {type, difficulty, question, options[], correct_index, explanation, concepts_ref[]}.`;
  const user = `Conceitos agrupados por SOURCE com quotas explícitas:\n\n${conceptsBlock}\n\nGere ${QUESTION_COUNT} perguntas no total, RESPEITANDO a quota de cada source.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);

  return {
    pipeline: 'SOURCE_RR (1+ pergunta por source)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: performance.now() - t1,
    conceptsUsed: allConcepts,
  };
}

// ───────── Métricas ───────────────────────────────────────────────────────

interface Metrics {
  pipeline: string;
  totalTimeSec: number;
  setupTimeMs: number;
  generationTimeSec: number;
  questions: number;
  sourcesReferenced: number;
  totalSources: number;
  coverageRatio: number;
  questionsPerSource: Record<string, number>;
  balanceStdDev: number;
  uniqueConceptsRef: number;
  diversityRatio: number;
}

function computeMetrics(result: PipelineResult, totalTimeSec: number): Metrics {
  const conceptToSource = new Map<string, string>();
  for (const c of result.conceptsUsed) {
    conceptToSource.set(c.name.toLowerCase().trim(), c.sourceFilename);
  }
  const questionsPerSource: Record<string, number> = {};
  const allRefs: string[] = [];
  for (const filename of new Set(result.conceptsUsed.map((c) => c.sourceFilename))) {
    questionsPerSource[filename] = 0;
  }
  for (const q of result.questions) {
    const refs = q.conceptsRef ?? [];
    if (refs.length === 0) continue;
    const srcs = new Set<string>();
    for (const r of refs) {
      const src = conceptToSource.get(r.toLowerCase().trim());
      if (src) srcs.add(src);
      allRefs.push(r.toLowerCase().trim());
    }
    for (const s of srcs) questionsPerSource[s] = (questionsPerSource[s] ?? 0) + 1;
  }
  const totalSources = new Set(result.conceptsUsed.map((c) => c.sourceFilename)).size;
  const sourcesReferenced = Object.values(questionsPerSource).filter((n) => n > 0).length;
  const counts = Object.values(questionsPerSource);
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1);
  const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / Math.max(counts.length, 1);
  const uniqueRefs = new Set(allRefs).size;
  return {
    pipeline: result.pipeline,
    totalTimeSec: totalTimeSec / 1000,
    setupTimeMs: result.setupTimeMs,
    generationTimeSec: result.generationTimeMs / 1000,
    questions: result.questions.length,
    sourcesReferenced,
    totalSources,
    coverageRatio: totalSources > 0 ? sourcesReferenced / totalSources : 0,
    questionsPerSource,
    balanceStdDev: Math.sqrt(variance),
    uniqueConceptsRef: uniqueRefs,
    diversityRatio: allRefs.length > 0 ? uniqueRefs / allRefs.length : 0,
  };
}

// ───────── Run ────────────────────────────────────────────────────────────

console.log('\n📊 Análise dos sources…');
const allConcepts: ConceptWithSource[] = [];
for (const s of sources) {
  const concepts = await analyzeOnce(s);
  for (const c of concepts) allConcepts.push({ ...c, sourceId: s.id, sourceFilename: s.filename });
}
console.log(`  ${allConcepts.length} conceitos extraídos`);

const results: PipelineResult[] = [];
const metrics: Metrics[] = [];

console.log('\n🟢 NEW (K-means + embeddings)…');
const tN = performance.now();
const rN = await pipelineNew(allConcepts);
metrics.push(computeMetrics(rN, performance.now() - tN));
results.push(rN);
console.log(`  ${rN.questions.length} perguntas`);

console.log('\n🟠 TFIDF_PURE (top-N ranking)…');
const tT = performance.now();
const rT = await pipelineTfidfPure(allConcepts);
metrics.push(computeMetrics(rT, performance.now() - tT));
results.push(rT);
console.log(`  ${rT.questions.length} perguntas`);

console.log('\n🔷 BERT_PURE (centroid + MMR)…');
const tB = performance.now();
const rB = await pipelineBertPure(allConcepts);
metrics.push(computeMetrics(rB, performance.now() - tB));
results.push(rB);
console.log(`  ${rB.questions.length} perguntas`);

console.log('\n🟢🔁 SOURCE_RR (round-robin)…');
const tS = performance.now();
const rS = await pipelineSourceRR(allConcepts);
metrics.push(computeMetrics(rS, performance.now() - tS));
results.push(rS);
console.log(`  ${rS.questions.length} perguntas`);

const cost = claudeIn * (3.0 / 1_000_000) + claudeOut * (15.0 / 1_000_000);

// ───────── Relatório ──────────────────────────────────────────────────────
let report = `# Comparativo V2 — pipelines sem K-means + cobertura forçada\n\n`;
report += `**Tópico:** \`${TOPIC_ID.slice(0, 8)}…\` — ${sources.length} sources · count=${QUESTION_COUNT}\n`;
report += `**Sources:**\n${sources.map((s) => `  - ${s.filename}`).join('\n')}\n\n`;
report += `**Conceitos extraídos:** ${allConcepts.length}\n`;
report += `**Custo:** ~$${cost.toFixed(2)} (${claudeIn} in + ${claudeOut} out)\n\n---\n\n`;

report += `## Métricas comparativas\n\n`;
report += `| Pipeline | Tempo | Setup | Geração | Q | Cobertura | Balance σ | Diversidade |\n|---|---|---|---|---|---|---|---|\n`;
for (const m of metrics) {
  report += `| **${m.pipeline}** | ${m.totalTimeSec.toFixed(1)}s | ${m.setupTimeMs.toFixed(0)}ms | ${m.generationTimeSec.toFixed(1)}s | ${m.questions} | ${(m.coverageRatio * 100).toFixed(0)}% (${m.sourcesReferenced}/${m.totalSources}) | ${m.balanceStdDev.toFixed(2)} | ${(m.diversityRatio * 100).toFixed(0)}% |\n`;
}

report += `\n## Distribuição por source\n\n`;
const allFilenames = new Set<string>();
for (const m of metrics) Object.keys(m.questionsPerSource).forEach((f) => allFilenames.add(f));
report += `| Source | NEW | TFIDF_PURE | BERT_PURE | SOURCE_RR |\n|---|---|---|---|---|\n`;
for (const f of allFilenames) {
  const short = f.length > 50 ? f.slice(0, 47) + '…' : f;
  report += `| ${short} | ${metrics[0]?.questionsPerSource[f] ?? 0} | ${metrics[1]?.questionsPerSource[f] ?? 0} | ${metrics[2]?.questionsPerSource[f] ?? 0} | ${metrics[3]?.questionsPerSource[f] ?? 0} |\n`;
}

report += `\n---\n\n## Perguntas geradas\n\n`;
for (const r of results) {
  report += `### ${r.pipeline}\n\n`;
  if (r.questions.length === 0) { report += `_(falhou)_\n\n`; continue; }
  for (const [i, q] of r.questions.entries()) {
    report += `**${i + 1}.** ${q.question}\n`;
    for (const [j, opt] of q.options.entries()) {
      const marker = j === q.correctIndex ? '✅' : '  ';
      report += `${marker} ${String.fromCharCode(97 + j)}) ${opt}\n`;
    }
    if (q.conceptsRef && q.conceptsRef.length > 0) {
      report += `   _refs: ${q.conceptsRef.slice(0, 3).join(', ')}_\n`;
    }
    report += `\n`;
  }
}

const reportPath = join(__dirname, `compare-pipelines-v2.${REPORT_SUFFIX}.report.md`);
writeFileSync(reportPath, report, 'utf8');
console.log(`\n✅ Salvo em ${reportPath}`);
console.log(`💰 Custo: ~$${cost.toFixed(2)}`);

db.close();

}

main().catch((e) => { console.error(e); process.exit(1); });
