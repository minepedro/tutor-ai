/*
  Compara 4 pipelines de geração de quiz (v0.9.x test):
  1. OLD: lista flat de conceitos (pré-v0.9, modelo decide cobertura)
  2. NEW: K-means + embeddings → clusters semânticos (v0.9.0 atual)
  3. KEYBERT: keywords extraídas via KeyBERT-like (substitui análise Claude)
  4. TFIDF: K-means + vetores TF-IDF (substitui embeddings)

  Métricas: tempo, custo (tokens), cobertura por source, balance, diversidade.
  Output: scripts/compare-pipelines.report.md (gitignored).

  Uso: npx tsx scripts/compare-pipelines.ts
  Custo estimado: $1-2 de API Anthropic por rodada.
*/
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import Anthropic from '@anthropic-ai/sdk';

// ───────── Setup paths ────────────────────────────────────────────────────
const userDataPath = join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'tutor-ai',
);
const dbPath = join(userDataPath, 'database.db');
const modelPath = join(userDataPath, 'models', 'all-MiniLM-L6-v2.onnx');
const apiKeyPath = join(userDataPath, '.apikey');

if (!existsSync(dbPath)) throw new Error(`DB não encontrado: ${dbPath}`);
if (!existsSync(modelPath)) throw new Error(`Modelo ONNX não encontrado.`);
if (!existsSync(apiKeyPath)) throw new Error(`API key não configurada.`);

// ───────── Configuração do teste ──────────────────────────────────────────

// CLI args:
//   --topic-id=<uuid>   default: scdsxzadsa (mix de domínios)
//   --count=<N>         default: 10
//   --suffix=<str>      default: "" — sufixo no nome do report (ex: "scenario-A")
function getArg(name: string, def: string): string {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] ?? def : def;
}

const TOPIC_ID = getArg('topic-id', '4f3c5439-0e95-454a-a52a-750d96441ca4');
const QUESTION_COUNT = parseInt(getArg('count', '10'), 10);
const REPORT_SUFFIX = getArg('suffix', '');
const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

// Custo estimado de tokens (USD por 1M tokens)
const SONNET_INPUT_USD = 3.0 / 1_000_000;
const SONNET_OUTPUT_USD = 15.0 / 1_000_000;
const HAIKU_INPUT_USD = 1.0 / 1_000_000;
const HAIKU_OUTPUT_USD = 5.0 / 1_000_000;

async function main() {

// ───────── DB + sources ───────────────────────────────────────────────────
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

if (sources.length === 0) {
  throw new Error('Nenhuma source processada nesse tópico.');
}
console.log(`📂 ${sources.length} sources processados:`);
sources.forEach((s) => console.log(`  • ${s.filename}`));

// ───────── Anthropic client ───────────────────────────────────────────────
const apiKeyRaw = require('node:fs').readFileSync(apiKeyPath);
let apiKey: string;
try {
  // Tenta como base64 (fallback do safeStorage)
  apiKey = Buffer.from(apiKeyRaw.toString('utf-8'), 'base64').toString('utf-8');
  if (!apiKey.startsWith('sk-')) throw new Error('not base64');
} catch {
  // Encriptado via safeStorage — não dá pra desencriptar fora do Electron
  console.error('⚠️ API key está encriptada com safeStorage — esse script só roda fora do Electron.');
  console.error('   Workaround: copie a key manualmente ou rode o teste DENTRO do app.');
  console.error('   Por ora vou usar variável de ambiente ANTHROPIC_API_KEY se existir...');
  apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  if (!apiKey) throw new Error('Sem API key acessível.');
}
const anthropic = new Anthropic({ apiKey });

// ───────── Embedding setup (ONNX local) ───────────────────────────────────
const transformers = await import('@xenova/transformers');
transformers.env.cacheDir = join(userDataPath, 'models', 'transformers-cache');
transformers.env.allowLocalModels = false;
const tokenizer = await transformers.AutoTokenizer.from_pretrained(
  'Xenova/all-MiniLM-L6-v2',
);
const ortSession = await ort.InferenceSession.create(modelPath, {
  executionProviders: ['cpu'],
});

async function embed(text: string): Promise<number[]> {
  const encoded = await tokenizer(text, {
    padding: true,
    truncation: true,
    max_length: 256,
  });
  const inputIds = encoded.input_ids.data as BigInt64Array;
  const attentionMask = encoded.attention_mask.data as BigInt64Array;
  const seqLen = encoded.input_ids.dims[1] ?? inputIds.length;
  const tokenTypeIds = new BigInt64Array(seqLen).fill(0n);
  const results = await ortSession.run({
    input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
  });
  const hidden = results['last_hidden_state']!.data as Float32Array;
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

// ───────── Helpers genéricos ──────────────────────────────────────────────

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

// K-means genérico (aceita qualquer função de distância)
function kmeans(
  vectors: number[][],
  k: number,
  distFn: (a: number[], b: number[]) => number = cosineDistance,
): number[] {
  const n = vectors.length;
  if (n <= k) return vectors.map((_, i) => i);

  // K-means++ init
  const centroidIdxs: number[] = [];
  centroidIdxs.push(Math.floor(Math.random() * n));
  for (let c = 1; c < k; c++) {
    const dists = vectors.map((v) => {
      let min = Infinity;
      for (const ci of centroidIdxs) {
        const d = distFn(v, vectors[ci]!);
        if (d < min) min = d;
      }
      return min * min;
    });
    const total = dists.reduce((s, d) => s + d, 0);
    if (total === 0) break;
    let r = Math.random() * total;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i]!;
      if (r <= 0) {
        centroidIdxs.push(i);
        break;
      }
    }
  }

  let centroids = centroidIdxs.map((i) => [...vectors[i]!]);
  let assignments = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < 50; iter++) {
    const newAssignments = vectors.map((v) => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = distFn(v, centroids[i]!);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    });
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
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

// ───────── TF-IDF helper ──────────────────────────────────────────────────
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

const STOPWORDS_PT = new Set([
  'que', 'para', 'com', 'por', 'das', 'dos', 'mais', 'sua', 'seu', 'esta',
  'este', 'isso', 'isto', 'são', 'foi', 'ser', 'ter', 'tem', 'pelo', 'pela',
  'numa', 'num', 'aos', 'mas', 'também', 'como', 'quando', 'onde', 'porque',
  'então', 'depois', 'ainda', 'sem', 'sobre', 'entre', 'estão', 'pode',
  'faz', 'fez', 'sim', 'não', 'todo', 'toda', 'todos', 'todas', 'cada',
]);

function tfidfVectors(docs: string[]): number[][] {
  // Build vocabulary
  const allTokens = docs.map(tokenize);
  const vocab = new Map<string, number>();
  for (const tokens of allTokens) {
    for (const t of tokens) {
      if (STOPWORDS_PT.has(t)) continue;
      if (!vocab.has(t)) vocab.set(t, vocab.size);
    }
  }
  const V = vocab.size;
  const N = docs.length;

  // DF
  const df = new Array<number>(V).fill(0);
  for (const tokens of allTokens) {
    const seen = new Set<string>();
    for (const t of tokens) {
      if (vocab.has(t) && !seen.has(t)) {
        df[vocab.get(t)!] = (df[vocab.get(t)!] ?? 0) + 1;
        seen.add(t);
      }
    }
  }

  // TF-IDF vectors
  return allTokens.map((tokens) => {
    const tf = new Array<number>(V).fill(0);
    for (const t of tokens) {
      if (vocab.has(t)) tf[vocab.get(t)!] = (tf[vocab.get(t)!] ?? 0) + 1;
    }
    const total = tokens.length || 1;
    const vec = new Array<number>(V).fill(0);
    for (let i = 0; i < V; i++) {
      const tfNorm = (tf[i] ?? 0) / total;
      const idf = Math.log((N + 1) / ((df[i] ?? 0) + 1)) + 1;
      vec[i] = tfNorm * idf;
    }
    return vec;
  });
}

// ───────── KeyBERT-like extractor ─────────────────────────────────────────
/*
  KeyBERT real: extrai n-grams candidatos do texto, embeda cada um e o doc inteiro,
  ranqueia n-grams por similaridade cosine ao doc. Pega top-K.

  Versão simplificada aqui: usa nossos embeddings ONNX. N-grams 1-3 palavras,
  sem stopwords. K configurable.
*/
async function keybertLikeExtract(text: string, topK: number): Promise<string[]> {
  const truncated = text.slice(0, 8000); // limita pra não estourar
  const tokens = truncated.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS_PT.has(w));

  // Gera n-grams 1-3
  const ngrams = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      const gram = tokens.slice(i, i + n).join(' ');
      if (gram.length >= 3) ngrams.add(gram);
    }
  }
  const candidates = Array.from(ngrams).slice(0, 200); // limit pra não embedar 1000

  if (candidates.length === 0) return [];

  // Embed doc + candidates
  const docVec = await embed(truncated);
  const candVecs = await Promise.all(candidates.map((c) => embed(c)));

  // Score cada candidato por similaridade ao doc
  const scored = candidates.map((c, i) => ({
    keyword: c,
    score: 1 - cosineDistance(docVec, candVecs[i]!),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Diversificar (MMR-like simples): pega top, depois itera evitando duplicatas semânticas
  const selected: { keyword: string; vec: number[] }[] = [];
  const seenWords = new Set<string>();
  for (const item of scored) {
    if (selected.length >= topK) break;
    const words = item.keyword.split(' ');
    if (words.some((w) => seenWords.has(w))) continue;
    selected.push({ keyword: item.keyword, vec: candVecs[candidates.indexOf(item.keyword)]! });
    words.forEach((w) => seenWords.add(w));
  }

  return selected.map((s) => s.keyword);
}

// ───────── Análise Claude (compartilhada entre OLD/NEW/TFIDF) ─────────────
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

let claudeTokensInput = 0;
let claudeTokensOutput = 0;

async function analyzeOnce(source: SourceRow): Promise<ExtractedConcept[]> {
  if (source.extracted_concepts) {
    try {
      const cached = JSON.parse(source.extracted_concepts) as { concepts?: ExtractedConcept[] };
      if (cached.concepts) return cached.concepts;
    } catch {}
  }
  // Sem cache: chama Claude
  const sys = `Você é um analista de material de estudo. Extraia conceitos centrais.

REGRAS:
- Ignore metadados (capa, autor, índice)
- Foque em conceitos, definições, fórmulas, processos
- Diferencie "core" de "supporting"

FORMATO: APENAS JSON (sem markdown):
{ "concepts": [{ "name": "...", "definition": "...", "importance": "core"|"supporting", "related": [] }] }`;
  const text = (source.raw_text ?? '').slice(0, 50_000);
  const resp = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4096,
    temperature: 0.3,
    system: sys,
    messages: [{ role: 'user', content: `Material:\n\n${text}` }],
  });
  claudeTokensInput += resp.usage.input_tokens;
  claudeTokensOutput += resp.usage.output_tokens;
  const block = resp.content.find((b) => b.type === 'text');
  const raw = block?.type === 'text' ? block.text : '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { concepts?: ExtractedConcept[] };
    return parsed.concepts ?? [];
  } catch { return []; }
}

// ───────── Geração via Claude ─────────────────────────────────────────────
interface GeneratedQ {
  type: string;
  difficulty: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  conceptsRef?: string[];
}

async function generateFromPrompt(
  systemPrompt: string,
  userPrompt: string,
  count: number,
): Promise<GeneratedQ[]> {
  const maxTokens = Math.min(700 * count + 2000, 8192);
  const resp = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: maxTokens,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  claudeTokensInput += resp.usage.input_tokens;
  claudeTokensOutput += resp.usage.output_tokens;
  const block = resp.content.find((b) => b.type === 'text');
  const raw = block?.type === 'text' ? block.text : '';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as Array<{
      type?: string; difficulty?: string; question?: string; options?: string[];
      correct_index?: number; explanation?: string; concepts_ref?: string[];
    }>;
    return arr
      .filter((q) => q.question && Array.isArray(q.options))
      .map((q) => ({
        type: q.type ?? 'multiple_choice',
        difficulty: q.difficulty ?? 'medium',
        question: q.question!,
        options: q.options!,
        correctIndex: q.correct_index ?? 0,
        explanation: q.explanation ?? '',
        conceptsRef: q.concepts_ref ?? [],
      }));
  } catch { return []; }
}

// ───────── 4 Pipelines ────────────────────────────────────────────────────

interface PipelineResult {
  pipeline: string;
  questions: GeneratedQ[];
  setupTimeMs: number;
  generationTimeMs: number;
  conceptsUsed: ConceptWithSource[];
}

// PIPELINE 1: OLD — lista flat de conceitos
async function pipelineOld(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const list = allConcepts
    .map((c) => `- ${c.name} [${c.importance}]: ${c.definition}`)
    .join('\n');
  const setupTime = performance.now() - t0;

  const sys = `Você é um professor que cria quizzes. Gere ${QUESTION_COUNT} perguntas testando compreensão.
- Distratores plausíveis. Misture dificuldades.
- FORMATO: array JSON com {type, difficulty, question, options[], correct_index, explanation, concepts_ref}.`;
  const user = `Conceitos:\n${list}\n\nGere ${QUESTION_COUNT} perguntas.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  const genTime = performance.now() - t1;

  return {
    pipeline: 'OLD (flat)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: genTime,
    conceptsUsed: allConcepts,
  };
}

// PIPELINE 2: NEW — K-means + embeddings
async function pipelineNew(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const k = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(allConcepts.length))));
  const vecs = await Promise.all(
    allConcepts.map((c) => embed(`${c.name}: ${c.definition}`)),
  );
  const assignments = kmeans(vecs, k, cosineDistance);
  const clusters: ConceptWithSource[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < allConcepts.length; i++) {
    clusters[assignments[i]!]?.push(allConcepts[i]!);
  }
  const nonEmpty = clusters.filter((c) => c.length > 0);
  shuffleInPlace(nonEmpty);
  const setupTime = performance.now() - t0;

  const baseQuota = Math.floor(QUESTION_COUNT / nonEmpty.length);
  const remainder = QUESTION_COUNT - baseQuota * nonEmpty.length;
  const text = nonEmpty
    .map((cluster, idx) => {
      const quota = baseQuota + (idx < remainder ? 1 : 0);
      const items = cluster.map((c) => `  - ${c.name} [${c.importance}]: ${c.definition}`).join('\n');
      return `[TEMA ${idx + 1}] ~${quota} perguntas\n${items}`;
    })
    .join('\n\n');

  const sys = `Você é um professor que cria quizzes. Gere ${QUESTION_COUNT} perguntas DISTRIBUÍDAS UNIFORMEMENTE entre os temas.
- Distratores = misconceptions plausíveis.
- FORMATO: array JSON com {type, difficulty, question, options[], correct_index, explanation, concepts_ref}.`;
  const user = `Conceitos agrupados em ${nonEmpty.length} temas:\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  const genTime = performance.now() - t1;

  return {
    pipeline: 'NEW (K-means + embeddings)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: genTime,
    conceptsUsed: allConcepts,
  };
}

// PIPELINE 3: KEYBERT — keywords extraídas via KeyBERT-like
async function pipelineKeybert(): Promise<PipelineResult> {
  const t0 = performance.now();
  // Pra cada source: extrai top-N keywords via KeyBERT-like
  const KEYWORDS_PER_SOURCE = 8;
  const keywordsBySource: { sourceId: string; sourceFilename: string; keywords: string[] }[] = [];
  for (const s of sources) {
    const kws = await keybertLikeExtract(s.raw_text!, KEYWORDS_PER_SOURCE);
    keywordsBySource.push({
      sourceId: s.id,
      sourceFilename: s.filename,
      keywords: kws,
    });
  }

  // Cluster: K-means + embeddings dos keywords
  const allKw: { keyword: string; sourceId: string; sourceFilename: string }[] = [];
  for (const ks of keywordsBySource) {
    for (const kw of ks.keywords) {
      allKw.push({ keyword: kw, sourceId: ks.sourceId, sourceFilename: ks.sourceFilename });
    }
  }
  if (allKw.length === 0) {
    return {
      pipeline: 'KEYBERT',
      questions: [],
      setupTimeMs: performance.now() - t0,
      generationTimeMs: 0,
      conceptsUsed: [],
    };
  }
  const k = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(allKw.length))));
  const vecs = await Promise.all(allKw.map((k) => embed(k.keyword)));
  const assignments = kmeans(vecs, k, cosineDistance);
  const clusters: typeof allKw[number][][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < allKw.length; i++) clusters[assignments[i]!]?.push(allKw[i]!);
  const nonEmpty = clusters.filter((c) => c.length > 0);
  shuffleInPlace(nonEmpty);
  const setupTime = performance.now() - t0;

  const baseQuota = Math.floor(QUESTION_COUNT / nonEmpty.length);
  const remainder = QUESTION_COUNT - baseQuota * nonEmpty.length;
  const text = nonEmpty
    .map((cluster, idx) => {
      const quota = baseQuota + (idx < remainder ? 1 : 0);
      const items = cluster.map((k) => `  - ${k.keyword} (de ${k.sourceFilename})`).join('\n');
      return `[TEMA ${idx + 1}] ~${quota} perguntas\n${items}`;
    })
    .join('\n\n');

  const sys = `Você é um professor que cria quizzes baseado em PALAVRAS-CHAVE extraídas dos materiais.
- Use seu conhecimento + as keywords pra criar perguntas significativas
- Gere ${QUESTION_COUNT} perguntas DISTRIBUÍDAS UNIFORMEMENTE entre os temas.
- Distratores = misconceptions plausíveis.
- FORMATO: array JSON com {type, difficulty, question, options[], correct_index, explanation, concepts_ref}.`;
  const user = `Keywords agrupadas em ${nonEmpty.length} temas:\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  const genTime = performance.now() - t1;

  // Conceitos pseudo (pra métricas)
  const conceptsUsed: ConceptWithSource[] = allKw.map((k) => ({
    name: k.keyword,
    definition: '',
    importance: 'core' as const,
    sourceId: k.sourceId,
    sourceFilename: k.sourceFilename,
  }));

  return {
    pipeline: 'KEYBERT',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: genTime,
    conceptsUsed,
  };
}

// PIPELINE 4: TFIDF — K-means + vetores TF-IDF
async function pipelineTfidf(allConcepts: ConceptWithSource[]): Promise<PipelineResult> {
  const t0 = performance.now();
  const docs = allConcepts.map((c) => `${c.name} ${c.definition}`);
  const vecs = tfidfVectors(docs);

  // Distância: cosine pros vetores TF-IDF (mesmo cosineDistance funciona)
  const k = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(allConcepts.length))));
  const assignments = kmeans(vecs, k, cosineDistance);
  const clusters: ConceptWithSource[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < allConcepts.length; i++) {
    clusters[assignments[i]!]?.push(allConcepts[i]!);
  }
  const nonEmpty = clusters.filter((c) => c.length > 0);
  shuffleInPlace(nonEmpty);
  const setupTime = performance.now() - t0;

  const baseQuota = Math.floor(QUESTION_COUNT / nonEmpty.length);
  const remainder = QUESTION_COUNT - baseQuota * nonEmpty.length;
  const text = nonEmpty
    .map((cluster, idx) => {
      const quota = baseQuota + (idx < remainder ? 1 : 0);
      const items = cluster.map((c) => `  - ${c.name} [${c.importance}]: ${c.definition}`).join('\n');
      return `[TEMA ${idx + 1}] ~${quota} perguntas\n${items}`;
    })
    .join('\n\n');

  const sys = `Você é um professor que cria quizzes. Gere ${QUESTION_COUNT} perguntas DISTRIBUÍDAS UNIFORMEMENTE entre os temas.
- Distratores = misconceptions plausíveis.
- FORMATO: array JSON com {type, difficulty, question, options[], correct_index, explanation, concepts_ref}.`;
  const user = `Conceitos agrupados em ${nonEmpty.length} temas (TF-IDF):\n\n${text}\n\nGere ${QUESTION_COUNT} perguntas.`;

  const t1 = performance.now();
  const questions = await generateFromPrompt(sys, user, QUESTION_COUNT);
  const genTime = performance.now() - t1;

  return {
    pipeline: 'TFIDF (K-means + TF-IDF)',
    questions,
    setupTimeMs: setupTime,
    generationTimeMs: genTime,
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

function computeMetrics(
  result: PipelineResult,
  totalTimeSec: number,
): Metrics {
  // Mapeia conceito → sourceFilename
  const conceptToSource = new Map<string, string>();
  for (const c of result.conceptsUsed) {
    conceptToSource.set(c.name.toLowerCase().trim(), c.sourceFilename);
  }

  // Pra cada pergunta, identifica sources via concepts_ref
  const questionsPerSource: Record<string, number> = {};
  const allRefs: string[] = [];
  for (const filename of new Set(result.conceptsUsed.map((c) => c.sourceFilename))) {
    questionsPerSource[filename] = 0;
  }

  let questionsWithRef = 0;
  for (const q of result.questions) {
    const refs = q.conceptsRef ?? [];
    if (refs.length === 0) continue;
    questionsWithRef++;
    const sources = new Set<string>();
    for (const r of refs) {
      const src = conceptToSource.get(r.toLowerCase().trim());
      if (src) sources.add(src);
      allRefs.push(r.toLowerCase().trim());
    }
    for (const s of sources) {
      questionsPerSource[s] = (questionsPerSource[s] ?? 0) + 1;
    }
  }

  const totalSources = new Set(result.conceptsUsed.map((c) => c.sourceFilename)).size;
  const sourcesReferenced = Object.values(questionsPerSource).filter((n) => n > 0).length;
  const coverageRatio = totalSources > 0 ? sourcesReferenced / totalSources : 0;

  const counts = Object.values(questionsPerSource);
  const mean = counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1);
  const variance = counts.reduce((s, c) => s + (c - mean) ** 2, 0) / Math.max(counts.length, 1);
  const stdDev = Math.sqrt(variance);

  const uniqueRefs = new Set(allRefs).size;

  return {
    pipeline: result.pipeline,
    totalTimeSec: totalTimeSec / 1000,
    setupTimeMs: result.setupTimeMs,
    generationTimeSec: result.generationTimeMs / 1000,
    questions: result.questions.length,
    sourcesReferenced,
    totalSources,
    coverageRatio,
    questionsPerSource,
    balanceStdDev: stdDev,
    uniqueConceptsRef: uniqueRefs,
    diversityRatio: allRefs.length > 0 ? uniqueRefs / allRefs.length : 0,
  };
}

// ───────── Run ────────────────────────────────────────────────────────────

console.log('\n📊 Etapa 1: análise dos sources (cacheada quando possível)…');
const tAnalyze = performance.now();
const allConcepts: ConceptWithSource[] = [];
for (const s of sources) {
  const concepts = await analyzeOnce(s);
  for (const c of concepts) {
    allConcepts.push({
      ...c,
      sourceId: s.id,
      sourceFilename: s.filename,
    });
  }
}
console.log(`  ${allConcepts.length} conceitos extraídos em ${((performance.now() - tAnalyze) / 1000).toFixed(1)}s`);

const metrics: Metrics[] = [];
const results: PipelineResult[] = [];

console.log('\n🔵 Pipeline 1: OLD (flat list)…');
const t1 = performance.now();
const r1 = await pipelineOld(allConcepts);
const m1 = computeMetrics(r1, performance.now() - t1);
console.log(`  ${r1.questions.length} perguntas em ${m1.totalTimeSec.toFixed(1)}s`);
metrics.push(m1); results.push(r1);

console.log('\n🟢 Pipeline 2: NEW (K-means + embeddings)…');
const t2 = performance.now();
const r2 = await pipelineNew(allConcepts);
const m2 = computeMetrics(r2, performance.now() - t2);
console.log(`  ${r2.questions.length} perguntas em ${m2.totalTimeSec.toFixed(1)}s`);
metrics.push(m2); results.push(r2);

console.log('\n🟣 Pipeline 3: KEYBERT-like…');
const t3 = performance.now();
const r3 = await pipelineKeybert();
const m3 = computeMetrics(r3, performance.now() - t3);
console.log(`  ${r3.questions.length} perguntas em ${m3.totalTimeSec.toFixed(1)}s`);
metrics.push(m3); results.push(r3);

console.log('\n🟡 Pipeline 4: TF-IDF…');
const t4 = performance.now();
const r4 = await pipelineTfidf(allConcepts);
const m4 = computeMetrics(r4, performance.now() - t4);
console.log(`  ${r4.questions.length} perguntas em ${m4.totalTimeSec.toFixed(1)}s`);
metrics.push(m4); results.push(r4);

// ───────── Custo ──────────────────────────────────────────────────────────
const totalCostUsd =
  claudeTokensInput * SONNET_INPUT_USD + claudeTokensOutput * SONNET_OUTPUT_USD;

// ───────── Relatório ──────────────────────────────────────────────────────
let report = `# Comparativo de 4 pipelines de geração de quiz\n\n`;
report += `**Data:** ${new Date().toISOString().slice(0, 10)}\n`;
report += `**Tópico:** \`${TOPIC_ID.slice(0, 8)}…\` — ${sources.length} sources\n`;
report += `**Sources testadas:**\n${sources.map((s) => `  - ${s.filename}`).join('\n')}\n\n`;
report += `**Conceitos totais extraídos:** ${allConcepts.length}\n`;
report += `**Questões pedidas por pipeline:** ${QUESTION_COUNT}\n\n`;
report += `**Custo total Anthropic:** ~$${totalCostUsd.toFixed(2)} (${claudeTokensInput} in + ${claudeTokensOutput} out tokens)\n\n`;

report += `---\n\n## Métricas comparativas\n\n`;
report += `| Pipeline | Tempo | Setup | Geração | Questões | Cobertura | Balance (σ) | Diversidade |\n`;
report += `|---|---|---|---|---|---|---|---|\n`;
for (const m of metrics) {
  report += `| **${m.pipeline}** | ${m.totalTimeSec.toFixed(1)}s | ${m.setupTimeMs.toFixed(0)}ms | ${m.generationTimeSec.toFixed(1)}s | ${m.questions} | ${(m.coverageRatio * 100).toFixed(0)}% (${m.sourcesReferenced}/${m.totalSources}) | ${m.balanceStdDev.toFixed(2)} | ${(m.diversityRatio * 100).toFixed(0)}% |\n`;
}

report += `\n**Legenda:**\n`;
report += `- **Cobertura:** % de sources que tiveram pelo menos 1 pergunta referenciada\n`;
report += `- **Balance (σ):** desvio padrão de perguntas por source — MENOR = mais uniforme\n`;
report += `- **Diversidade:** conceitos únicos referenciados / total de refs — MAIOR = mais variado\n\n`;

report += `## Distribuição de perguntas por source\n\n`;
report += `| Source | OLD | NEW | KEYBERT | TFIDF |\n|---|---|---|---|---|\n`;
const allFilenames = new Set<string>();
for (const m of metrics) Object.keys(m.questionsPerSource).forEach((f) => allFilenames.add(f));
for (const f of allFilenames) {
  const short = f.length > 50 ? f.slice(0, 47) + '…' : f;
  const o = metrics[0]?.questionsPerSource[f] ?? 0;
  const n = metrics[1]?.questionsPerSource[f] ?? 0;
  const k = metrics[2]?.questionsPerSource[f] ?? 0;
  const t = metrics[3]?.questionsPerSource[f] ?? 0;
  report += `| ${short} | ${o} | ${n} | ${k} | ${t} |\n`;
}

report += `\n---\n\n## Perguntas geradas (qualitativo — você julga)\n\n`;
for (const r of results) {
  report += `### ${r.pipeline}\n\n`;
  if (r.questions.length === 0) {
    report += `_(falhou — sem perguntas geradas)_\n\n`;
    continue;
  }
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
  report += `\n`;
}

const reportFile = REPORT_SUFFIX
  ? `compare-pipelines.${REPORT_SUFFIX}.report.md`
  : 'compare-pipelines.report.md';
const reportPath = join(__dirname, reportFile);
writeFileSync(reportPath, report, 'utf8');
console.log(`\n✅ Relatório salvo em ${reportPath}`);
console.log(`💰 Custo total: ~$${totalCostUsd.toFixed(2)}`);

db.close();

}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
