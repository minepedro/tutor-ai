import { readFile } from 'node:fs/promises';
import pdf from 'pdf-parse';

/*
  Extração de texto de PDF. v0.2.0 usa `pdf-parse` (node-only, simples,
  baseado em pdf.js do Mozilla). Retorna o texto integral concatenado.

  Limitações conhecidas:
  - Não preserva layout (colunas, tabelas viram texto linear)
  - Sem suporte a OCR — PDFs escaneados como imagem retornam string vazia
  - Sem metadado de página por chunk (a estrutura interna está disponível
    mas não a usamos pra simplificar o pipeline na v0.2.0)

  Se aparecerem PDFs que quebram (layout complexo, formulas LaTeX),
  upgrade pra `pdfjs-dist` da Mozilla é o próximo passo.
*/

export interface ParsedPdf {
  /** Texto bruto extraído (todas as páginas concatenadas). */
  text: string;
  /** Número de páginas no documento. */
  pageCount: number;
  /** Metadados embutidos no PDF (autor, título, etc), se existirem. */
  info: Record<string, unknown>;
}

export async function extractPdfText(filePath: string): Promise<ParsedPdf> {
  const buffer = await readFile(filePath);
  const data = await pdf(buffer);

  /*
    pdf-parse retorna `text` com muito \n consecutivo entre páginas e linhas.
    Normalizamos pra dois \n entre blocos (parágrafos) e remove os triplos+,
    o que ajuda o chunker a quebrar por parágrafos depois.
  */
  const normalized = normalizeWhitespace(data.text);

  return {
    text: normalized,
    pageCount: data.numpages,
    info: (data.info as Record<string, unknown> | undefined) ?? {},
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Windows line endings
    .replace(/\n{3,}/g, '\n\n') // muito \n vira \n\n (limite máximo de gap)
    .replace(/[ \t]+/g, ' ') // múltiplos espaços/tabs viram um espaço
    .replace(/[ \t]+\n/g, '\n') // espaços antes de \n são lixo
    .trim();
}
