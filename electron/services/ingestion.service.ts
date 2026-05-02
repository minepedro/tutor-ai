import { randomUUID } from 'node:crypto';
import { getSource, updateSourceProcessing } from '../database/repositories/sources.repo';
import {
  countChunksBySource,
  createChunksBatch,
  deleteChunksBySource,
} from '../database/repositories/chunks.repo';
import { extractPdfText } from '../utils/pdf-parser';
import { chunkText } from '../utils/text-chunker';
import { embed } from './embedding.service';
import {
  deleteChunkVectorsBySource,
  insertChunkVectors,
  type ChunkVectorRecord,
} from '../database/lancedb';

/*
  Pipeline de ingestão: source (PDF já em disco) → texto extraído → chunks →
  embeddings → SQLite (texto) + LanceDB (vetores).

  Etapas e percentuais reportados via onProgress:
    0%  →  iniciando
    5%  →  extraindo texto (PDF parser)
    20% →  texto extraído (X páginas, Y caracteres)
    25% →  dividindo em chunks
    30% →  N chunks criados, gerando embeddings
    30→90% →  embeddings (incrementa por chunk)
    95% →  salvando no LanceDB
    100% → concluído (Z chunks indexados)
*/

export type ProgressCallback = (pct: number, status: string) => void;

export interface IngestResult {
  sourceId: string;
  chunkCount: number;
  pageCount: number;
}

export async function ingestSource(
  sourceId: string,
  onProgress: ProgressCallback,
): Promise<IngestResult> {
  const source = getSource(sourceId);
  if (!source) throw new Error(`Source ${sourceId} não encontrada`);

  if (source.fileType !== 'pdf') {
    throw new Error(`Tipo de arquivo não suportado pela ingestão: ${source.fileType}`);
  }

  // Idempotência: se já tem chunks, limpa antes de re-processar.
  // Em v0.2.0 isso só acontece se o usuário forçar re-ingestão; o fluxo normal
  // de upload novo nunca cai aqui (source recém-criada não tem chunks).
  const existingCount = countChunksBySource(sourceId);
  if (existingCount > 0) {
    deleteChunksBySource(sourceId);
    await deleteChunkVectorsBySource(sourceId);
  }

  // ── 1. Extração ──────────────────────────────────────────────────────────
  onProgress(5, 'Lendo PDF…');
  const parsed = await extractPdfText(source.filePath);

  if (parsed.text.trim().length === 0) {
    throw new Error(
      'PDF sem texto extraível. Pode ser um PDF escaneado (OCR não suportado na v0.2.0).',
    );
  }

  onProgress(
    20,
    `${parsed.pageCount} ${parsed.pageCount === 1 ? 'página' : 'páginas'}, ` +
      `${formatNumber(parsed.text.length)} caracteres`,
  );

  // Persiste o texto bruto pra evitar reprocessamento se quisermos re-chunkar.
  updateSourceProcessing(sourceId, { rawText: parsed.text });

  // ── 2. Chunking ──────────────────────────────────────────────────────────
  onProgress(25, 'Dividindo em chunks…');
  const chunks = chunkText(parsed.text);

  if (chunks.length === 0) {
    throw new Error('Nenhum chunk gerado a partir do texto extraído.');
  }

  // ── 3. Persistência dos chunks (texto) ───────────────────────────────────
  // Geramos os IDs aqui pra usar os mesmos ao inserir no LanceDB.
  const chunkInputs = chunks.map((c) => ({
    id: randomUUID(),
    sourceId,
    chunkIndex: c.index,
    content: c.content,
    tokenCount: c.tokenCount,
  }));
  createChunksBatch(chunkInputs);

  onProgress(30, `${chunks.length} chunks criados — gerando embeddings…`);

  // ── 4. Embeddings ────────────────────────────────────────────────────────
  // Faixa 30–90 reservada pra essa etapa, distribuída por chunk processado.
  const vectors: ChunkVectorRecord[] = [];
  for (let i = 0; i < chunkInputs.length; i++) {
    const input = chunkInputs[i]!;
    const vec = await embed(input.content);
    vectors.push({
      id: input.id,
      source_id: sourceId,
      chunk_index: input.chunkIndex,
      vector: Array.from(vec), // LanceDB precisa de number[], não Float32Array
    });

    const pct = 30 + Math.round(((i + 1) / chunkInputs.length) * 60);
    onProgress(pct, `Embedding ${i + 1}/${chunkInputs.length}`);
  }

  // ── 5. Salvar vetores no LanceDB ─────────────────────────────────────────
  onProgress(95, 'Salvando vetores…');
  await insertChunkVectors(vectors);

  onProgress(100, `${chunks.length} chunks indexados`);

  return {
    sourceId,
    chunkCount: chunks.length,
    pageCount: parsed.pageCount,
  };
}

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
