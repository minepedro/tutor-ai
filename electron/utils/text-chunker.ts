import { detectStructuralLabel } from './structure-detector';

/*
  Chunker de texto para RAG. Estratégia (definida no ARCHITECTURE.md):

  1. Quebra primária por parágrafos (separadores: \n\n).
  2. Parágrafos curtos (≤ 500 tokens) viram um chunk inteiro.
  3. Parágrafos longos são subdivididos em janelas de ~500 tokens com 50
     tokens de overlap (sliding window). Quebra preferencialmente em espaço
     pra não cortar palavras ao meio.

  v0.5.0+:
  - Cada chunk preserva pageNumber (via chunkPages)
  - Cada chunk roda o detector de estrutura — se começa com "Exercício N",
    "Capítulo N", etc, ganha um structuralLabel pra citação na UI/prompt.

  Contagem de tokens: aproximação `chars / 4`. Não é exato (a tokenização
  real do BPE varia), mas é rápida, sem dependência, e suficiente porque o
  ONNX (all-MiniLM-L6-v2) trunca em 256 tokens internos de qualquer jeito.
*/

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN; // 2000
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN; // 200
/** Janela em que procuramos um espaço/quebra para evitar cortar palavra. */
const BREAK_LOOKBACK_CHARS = 100;

export interface TextChunk {
  /** Posição sequencial dentro do documento (0, 1, 2, ...). */
  index: number;
  /** Conteúdo do chunk (já trimado). */
  content: string;
  /** Estimativa de tokens — útil pra dashboards/debug. */
  tokenCount: number;
  /**
   * Número da página (1-based) onde este chunk se origina. Null pra chunks
   * gerados sem informação de página (chunkText legacy).
   */
  pageNumber: number | null;
  /**
   * Label estrutural detectado no início do chunk (ex: "exercício 5",
   * "capítulo 3"). Null se chunk é texto contínuo sem marcador.
   */
  structuralLabel: string | null;
}

/**
 * Versão preferida da v0.5.0: recebe páginas separadas e gera chunks
 * preservando o número da página em cada um. Chunks NÃO cruzam fronteiras
 * de página — cada chunk pertence a UMA página específica.
 *
 * Trade-off: páginas curtas (1 parágrafo) viram chunks pequenos. Aceitável
 * porque "página" é unidade lógica de material acadêmico e citações ficam
 * mais úteis ("página 14" > "chunk 26").
 */
export function chunkPages(pages: string[]): TextChunk[] {
  const chunks: TextChunk[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageText = pages[pageIdx]!;
    const pageNumber = pageIdx + 1; // 1-based pra apresentação

    chunkSingleText(pageText, chunks, pageNumber);
  }

  return chunks;
}

/**
 * Versão legacy (sem page info). Mantida pra retrocompatibilidade caso
 * algum teste/script use, mas o ingestion service deve usar `chunkPages`.
 */
export function chunkText(text: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  chunkSingleText(text, chunks, null);
  return chunks;
}

/*
  Lógica de chunking aplicada a UM bloco de texto (uma página, ou o doc todo
  na versão legacy). Modifica a array `chunks` in-place pra preservar os
  índices contínuos entre páginas.
*/
function chunkSingleText(
  text: string,
  chunks: TextChunk[],
  pageNumber: number | null,
): void {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  for (const paragraph of paragraphs) {
    if (paragraph.length <= TARGET_CHARS) {
      chunks.push({
        index: chunks.length,
        content: paragraph,
        tokenCount: estimateTokens(paragraph),
        pageNumber,
        structuralLabel: detectStructuralLabel(paragraph),
      });
      continue;
    }

    /*
      Sliding window. Avança em saltos de (TARGET_CHARS − OVERLAP_CHARS) e
      tenta quebrar em espaço pra não cortar palavra. Se não achar espaço
      em BREAK_LOOKBACK_CHARS, faz corte hard mesmo (garante progresso).
    */
    let start = 0;
    while (start < paragraph.length) {
      const idealEnd = Math.min(start + TARGET_CHARS, paragraph.length);
      const end = idealEnd >= paragraph.length ? idealEnd : findBreakPoint(paragraph, idealEnd);
      const slice = paragraph.slice(start, end).trim();

      if (slice.length > 0) {
        chunks.push({
          index: chunks.length,
          content: slice,
          tokenCount: estimateTokens(slice),
          pageNumber,
          /*
            Só o primeiro chunk de um parágrafo longo (start=0) carrega o
            label estrutural — slices posteriores são continuações do mesmo
            "exercício 5" e detectar de novo daria "false negative" (texto
            do meio do exercício não começa com "Exercício 5").
          */
          structuralLabel: start === 0 ? detectStructuralLabel(slice) : null,
        });
      }

      if (end >= paragraph.length) break;

      const nextStart = Math.max(end - OVERLAP_CHARS, start + 1);
      start = nextStart;
    }
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/*
  Procura o último whitespace antes de `idealEnd` numa janela de lookback.
  Isso evita cortar "antiderivada" no meio e gerar "antider" + "ivada".
*/
function findBreakPoint(text: string, idealEnd: number): number {
  const minEnd = Math.max(idealEnd - BREAK_LOOKBACK_CHARS, 0);
  for (let i = idealEnd; i >= minEnd; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') return i;
  }
  return idealEnd; // fallback: corte hard
}
