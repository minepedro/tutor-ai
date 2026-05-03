import { embed } from './embedding.service';
import {
  getChunksByIds,
  listChunkVectorsBySources,
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
  content: string;
  /** Cosine distance: 0 = idêntico, 1 = ortogonal, 2 = oposto. Menor = mais similar. */
  distance: number;
}

const DEFAULT_TOP_K = 5;

/**
 * Busca os top K chunks mais similares à query dentro do escopo.
 * Retorna lista vazia se não houver sources no escopo ou se a query não
 * conseguir gerar embedding (input vazio, etc).
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

  // Embedding da pergunta — usa o mesmo modelo dos chunks (all-MiniLM-L6-v2),
  // garantindo que vivem no mesmo espaço vetorial.
  const queryVector = await embed(trimmed);
  const queryArr = Array.from(queryVector);

  const vectors = await listChunkVectorsBySources(sourceIds);
  if (vectors.length === 0) return [];

  // Calcula distância pra cada chunk e ordena (menor = mais similar).
  const scored = vectors.map((v) => ({
    record: v,
    distance: cosineDistance(queryArr, v.vector),
  }));
  scored.sort((a, b) => a.distance - b.distance);

  const top = scored.slice(0, k);
  if (top.length === 0) return [];

  // Enriquece com texto + filename via SQLite.
  const chunkIds = top.map((s) => s.record.id);
  const chunks = getChunksByIds(chunkIds);
  const chunksById = new Map(chunks.map((c) => [c.id, c]));

  const filenamesBySource = new Map<string, string>();
  for (const sourceId of new Set(top.map((s) => s.record.source_id))) {
    const source = getSource(sourceId);
    if (source) filenamesBySource.set(sourceId, source.filename);
  }

  return top
    .map((s) => {
      const chunk = chunksById.get(s.record.id);
      if (!chunk) return null;
      return {
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        sourceFilename: filenamesBySource.get(chunk.sourceId) ?? '?',
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        distance: s.distance,
      } satisfies RagChunk;
    })
    .filter((c): c is RagChunk => c !== null);
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
