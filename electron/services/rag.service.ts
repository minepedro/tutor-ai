import { embed } from './embedding.service';
import {
  getChunksByIds,
  listChunkVectorsBySources,
  listChunksByStructuralLabel,
  searchChunksByFts,
  type DocumentChunk,
} from '../database/repositories/chunks.repo';
import {
  getSource,
  listSourcesByTopic,
} from '../database/repositories/sources.repo';
import { listTopicsBySubject } from '../database/repositories/topics.repo';

/*
  RAG (Retrieval-Augmented Generation) service.

  Responsabilidade: dada uma pergunta do usuário e um escopo, retornar os
  chunks de texto mais relevantes pra montar contexto da resposta.

  Fluxo:
  1. Resolve o escopo → lista de sourceIds permitidos
  2. Gera embedding da pergunta (BERT real, ver ADR-013)
  3. Carrega vetores de todos os chunks dessas sources
  4. Calcula cosine distance da pergunta pra cada chunk
  5. Ordena, pega top K, busca o texto + metadados em SQLite

  Estratégia de busca: scan completo + ranking em JS (ver ADR-019). Pra
  centenas/milhares de chunks roda em < 100ms. Quando virar gargalo
  (10k+ vetores), trocar pelo `table.search().where().limit()` nativo do
  LanceDB ou criar índice IVF.
*/

export type RagScope =
  | { type: 'document'; sourceId: string }
  | { type: 'topic'; topicId: string }
  | { type: 'subject'; subjectId: string };

export interface RagChunk {
  chunkId: string;
  sourceId: string;
  /** Filename original do PDF (pra citação na resposta). */
  sourceFilename: string;
  chunkIndex: number;
  /** Página (1-based) onde o chunk se origina. Null pra chunks legacy (v < 0.5). */
  pageNumber: number | null;
  /** Label estrutural detectado (ex: "exercício 5"). Null se não bateu padrão. */
  structuralLabel: string | null;
  content: string;
  /** Cosine distance: 0 = idêntico, 1 = ortogonal, 2 = oposto. Menor = mais similar. */
  distance: number;
}

const DEFAULT_TOP_K = 5;

/**
 * Busca os top K chunks mais similares à query dentro do escopo.
 * Retorna lista vazia se não houver sources no escopo ou se a query não
 * conseguir gerar embedding (input vazio, etc).
 *
 * Pipeline de busca (v0.6.0):
 * 1. Tenta filtro estrutural (ex: "exercício 5" → busca chunks com
 *    structural_label="exercício 5"). Se achou, retorna direto — match
 *    exato é melhor que similaridade aproximada.
 * 2. Fallback: busca semântica (cosine distance) — comportamento default.
 */
export async function searchByQuery(
  query: string,
  scope: RagScope,
  k: number = DEFAULT_TOP_K,
): Promise<RagChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const sourceIds = resolveSourceIds(scope);
  if (sourceIds.length === 0) return [];

  // ── Tentativa 1: filtro estrutural ──────────────────────────────────────
  const structuralFilter = extractStructuralFilter(trimmed);
  if (structuralFilter) {
    const matched = listChunksByStructuralLabel(sourceIds, structuralFilter);
    if (matched.length > 0) {
      console.log(
        `[rag] structural filter "${structuralFilter}" matched ${matched.length} chunks (skipping semantic search)`,
      );
      // Match exato — retorna até K, ordenado por source/index. Distance=0
      // sinaliza pro consumidor que match foi exato (UI mostra "100% match").
      return enrichChunks(matched.slice(0, k), 0);
    }
    console.log(
      `[rag] structural filter "${structuralFilter}" found 0 chunks — falling back to semantic search`,
    );
  }

  // ── Tentativa 2: busca híbrida (semântica + FTS, merge via RRF) ─────────
  /*
    Paralelo (na verdade sequencial mas barato):
    - Semântico: cosine distance dos vetores → top K candidatos
    - FTS: bm25 nos textos → top K candidatos
    - Merge via Reciprocal Rank Fusion (RRF):
        score = sum(1 / (RRF_K + rank_i)) pra cada engine
        RRF_K = 60 é o default da literatura
    - Ordena por score desc, retorna top K finais.

    Vantagem: semântico capta sinônimos/conceitos (BERT-style); FTS pega
    palavras raras/nomes próprios literais. Junto cobrem casos que cada um
    sozinho falharia.
  */
  const semanticHits = await searchSemantic(trimmed, sourceIds, k);
  const ftsHits = searchChunksByFts(sourceIds, trimmed, k);

  if (semanticHits.length === 0 && ftsHits.length === 0) return [];

  const merged = reciprocalRankFusion(semanticHits, ftsHits, k);
  return merged;
}

/**
 * Busca semântica isolada — retorna lista de chunks com cosine distance.
 * Extraída pra que a busca híbrida possa rodar em paralelo com FTS.
 */
async function searchSemantic(
  query: string,
  sourceIds: string[],
  k: number,
): Promise<Array<{ chunk: DocumentChunk; distance: number; rank: number }>> {
  const queryVector = await embed(query);
  const queryArr = Array.from(queryVector);

  const vectors = await listChunkVectorsBySources(sourceIds);
  if (vectors.length === 0) return [];

  const scored = vectors.map((v) => ({
    record: v,
    distance: cosineDistance(queryArr, v.vector),
  }));
  scored.sort((a, b) => a.distance - b.distance);

  const top = scored.slice(0, k);
  if (top.length === 0) return [];

  const chunkIds = top.map((s) => s.record.id);
  const chunks = getChunksByIds(chunkIds);
  const chunksById = new Map(chunks.map((c) => [c.id, c]));

  return top
    .map((s, idx) => {
      const chunk = chunksById.get(s.record.id);
      if (!chunk) return null;
      return { chunk, distance: s.distance, rank: idx };
    })
    .filter(
      (x): x is { chunk: DocumentChunk; distance: number; rank: number } =>
        x !== null,
    );
}

/**
 * Reciprocal Rank Fusion: merge das duas listas (semântica + FTS) em um
 * ranking único, sem precisar normalizar scores entre engines.
 *
 * Fórmula: pra cada chunk, score = Σ 1/(RRF_K + rank_engine_i)
 * RRF_K = 60 é o default da literatura — penaliza bem ranks distantes.
 *
 * Ref: Cormack, Clarke, Buettcher, "Reciprocal Rank Fusion outperforms
 * Condorcet and individual Rank Learning Methods" (SIGIR 2009).
 */
const RRF_K = 60;

function reciprocalRankFusion(
  semantic: Array<{ chunk: DocumentChunk; distance: number; rank: number }>,
  fts: Array<{ chunk: DocumentChunk; rank: number }>,
  k: number,
): RagChunk[] {
  type Score = { chunk: DocumentChunk; score: number; bestDistance: number };
  const scoreMap = new Map<string, Score>();

  for (const s of semantic) {
    scoreMap.set(s.chunk.id, {
      chunk: s.chunk,
      score: 1 / (RRF_K + s.rank),
      bestDistance: s.distance,
    });
  }

  for (const f of fts) {
    const existing = scoreMap.get(f.chunk.id);
    if (existing) {
      existing.score += 1 / (RRF_K + f.rank);
    } else {
      scoreMap.set(f.chunk.id, {
        chunk: f.chunk,
        score: 1 / (RRF_K + f.rank),
        // FTS não tem cosine distance; usamos sentinela alto.
        // UI mostra "similaridade ~0%" mas chunk veio do match textual.
        bestDistance: 1,
      });
    }
  }

  const ranked = Array.from(scoreMap.values()).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, k);

  // Enriquece com filenames (uma vez só, antes de mapear)
  const filenamesBySource = new Map<string, string>();
  for (const sourceId of new Set(top.map((s) => s.chunk.sourceId))) {
    const source = getSource(sourceId);
    if (source) filenamesBySource.set(sourceId, source.filename);
  }

  return top.map((s) => ({
    chunkId: s.chunk.id,
    sourceId: s.chunk.sourceId,
    sourceFilename: filenamesBySource.get(s.chunk.sourceId) ?? '?',
    chunkIndex: s.chunk.chunkIndex,
    pageNumber: s.chunk.pageNumber,
    structuralLabel: s.chunk.structuralLabel,
    content: s.chunk.content,
    distance: s.bestDistance,
  }));
}

/**
 * Resolve o escopo em uma lista de sourceIds. Cada caso:
 * - document: o próprio sourceId
 * - topic: todas as sources daquele tópico
 * - subject: todas as sources de todos os tópicos da matéria
 */
function resolveSourceIds(scope: RagScope): string[] {
  switch (scope.type) {
    case 'document':
      return [scope.sourceId];
    case 'topic':
      return listSourcesByTopic(scope.topicId).map((s) => s.id);
    case 'subject': {
      const topics = listTopicsBySubject(scope.subjectId);
      return topics.flatMap((t) => listSourcesByTopic(t.id).map((s) => s.id));
    }
  }
}

/*
  Cosine distance entre 2 vetores.

  Cosine similarity = (a · b) / (|a| · |b|)
  Cosine distance = 1 - cosine similarity (∈ [0, 2])

  Pra embeddings BERT-style, cosine é a métrica padrão (capturam direção
  semântica melhor que magnitude). Não normalizamos os vetores na geração
  pra evitar overhead, mas calculamos as magnitudes aqui.

  💡 noUncheckedIndexedAccess força tratar `a[i]` como `number | undefined`.
  Como `b.length` é o mesmo que `a.length` (ambos 384), `?? 0` é só pro tipo.
*/
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1; // edge case: vetor zero
  return 1 - dot / denom;
}

/*
  Enriquece DocumentChunks (vindos do SQLite) com filename do source-pai
  + distance fixa, transformando em RagChunks que vão pro frontend.

  Usado pelo caminho do filtro estrutural (todos com mesma distance).
  O caminho semântico monta RagChunks inline com distance variável por chunk.
*/
function enrichChunks(chunks: DocumentChunk[], distance: number): RagChunk[] {
  const filenamesBySource = new Map<string, string>();
  for (const sourceId of new Set(chunks.map((c) => c.sourceId))) {
    const source = getSource(sourceId);
    if (source) filenamesBySource.set(sourceId, source.filename);
  }

  return chunks.map((chunk) => ({
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    sourceFilename: filenamesBySource.get(chunk.sourceId) ?? '?',
    chunkIndex: chunk.chunkIndex,
    pageNumber: chunk.pageNumber,
    structuralLabel: chunk.structuralLabel,
    content: chunk.content,
    distance,
  }));
}

/*
  Detecta na query do usuário se ele menciona um label estrutural específico
  ("exercício 5", "capítulo 3", "questão 2.1"). Se sim, retorna o label
  normalizado pra usar como predicado SQL (`structural_label = ?`).

  Aceita PT-BR + EN. Aceita variações com/sem acento e captura o número.
  Match em qualquer posição da query (não precisa estar no início).

  Retorna a string EXATA que aparece na coluna `structural_label` do DB
  — assim o caller pode usar igualdade direta.
*/
const STRUCTURAL_QUERY_PATTERNS: Array<{ regex: RegExp; canonical: string }> = [
  // PT-BR
  { regex: /\b(exerc[íi]cios?)\s+(\d+(?:\.\d+)*)/i, canonical: 'exercício' },
  { regex: /\b(exemplos?)\s+(\d+(?:\.\d+)*)/i, canonical: 'exemplo' },
  { regex: /\b(quest[ãa]o|quest[ãoões]es)\s+(\d+(?:\.\d+)*)/i, canonical: 'questão' },
  { regex: /\b(problemas?)\s+(\d+(?:\.\d+)*)/i, canonical: 'problema' },
  { regex: /\b(cap[íi]tulos?)\s+(\d+(?:\.\d+)*)/i, canonical: 'capítulo' },
  { regex: /\b(se[çc][ãa]o|se[çc][ãoões]es)\s+(\d+(?:\.\d+)*)/i, canonical: 'seção' },
  { regex: /\b(unidades?)\s+(\d+(?:\.\d+)*)/i, canonical: 'unidade' },
  { regex: /\b(aulas?)\s+(\d+(?:\.\d+)*)/i, canonical: 'aula' },
  // EN
  { regex: /\b(exercises?)\s+(\d+(?:\.\d+)*)/i, canonical: 'exercise' },
  { regex: /\b(examples?)\s+(\d+(?:\.\d+)*)/i, canonical: 'example' },
  { regex: /\b(problems?)\s+(\d+(?:\.\d+)*)/i, canonical: 'problem' },
  { regex: /\b(questions?)\s+(\d+(?:\.\d+)*)/i, canonical: 'question' },
  { regex: /\b(chapters?)\s+(\d+(?:\.\d+)*)/i, canonical: 'chapter' },
  { regex: /\b(sections?)\s+(\d+(?:\.\d+)*)/i, canonical: 'section' },
];

function extractStructuralFilter(query: string): string | null {
  for (const { regex, canonical } of STRUCTURAL_QUERY_PATTERNS) {
    const match = query.match(regex);
    if (match) {
      const number = match[2]; // captura o número
      if (number) return `${canonical} ${number}`;
    }
  }
  return null;
}
