import { readFile } from 'node:fs/promises';
import pdf from 'pdf-parse';

/*
  Extração de texto de PDF.

  v0.5.0: além do texto integral, capturamos texto POR PÁGINA via callback
  `pagerender` do pdf-parse. Isso permite o chunker propagar `pageNumber`
  pra cada chunk e a UI/IA citar páginas reais ("página 14") em vez de
  índices internos ("chunk 26").

  Limitações conhecidas (não mudaram):
  - Não preserva layout (colunas, tabelas viram texto linear)
  - Sem suporte a OCR — PDFs escaneados como imagem retornam string vazia
  - Page numbers correspondem a páginas físicas do PDF, podem diferir da
    numeração visual (caso o PDF tenha capa/sumário antes da página "1")
*/

export interface ParsedPdf {
  /** Texto bruto concatenado (todas as páginas). Mantido pra retrocompat. */
  text: string;
  /** Texto por página, na ordem do PDF (índice 0 = página 1). */
  pages: string[];
  /** Número de páginas no documento. */
  pageCount: number;
  /** Metadados embutidos no PDF (autor, título, etc), se existirem. */
  info: Record<string, unknown>;
}

/*
  💡 PDF.js (motor interno do pdf-parse) entrega o texto da página como uma
  lista de "items", onde cada item tem `str`. Itens podem não ter `str` se
  forem markers de fonte/cor — checamos via type guard.
*/
interface TextItem {
  str: string;
}

function isTextItem(item: unknown): item is TextItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'str' in item &&
    typeof (item as TextItem).str === 'string'
  );
}

export async function extractPdfText(filePath: string): Promise<ParsedPdf> {
  const buffer = await readFile(filePath);

  /*
    pdf-parse processa páginas em ordem (1 → N) e chama o pagerender callback
    pra cada uma. Acumulamos o texto da página numa array via closure.
    O retorno do callback vira o texto que o pdf-parse usa pra montar `data.text`.
  */
  const pages: string[] = [];

  const data = await pdf(buffer, {
    pagerender: async (pageData: {
      getTextContent: () => Promise<{ items: unknown[] }>;
    }) => {
      const textContent = await pageData.getTextContent();
      const pageText = textContent.items
        .filter(isTextItem)
        .map((i) => i.str)
        .join(' ');
      pages.push(pageText);
      return pageText;
    },
  });

  /*
    `data.text` é a concatenação que pdf-parse fez juntando o retorno do
    pagerender de cada página. Normalizamos do mesmo jeito que antes pra
    o chunker funcionar igual.
  */
  const normalized = normalizeWhitespace(data.text);
  const normalizedPages = pages.map(normalizeWhitespace);

  return {
    text: normalized,
    pages: normalizedPages,
    pageCount: data.numpages,
    info: (data.info as Record<string, unknown> | undefined) ?? {},
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
