import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, ne, sql, count } from 'drizzle-orm';
import { getDrizzleDb } from '../connection';
import { sources, documentChunks } from '../drizzle/schema';

/*
  Sources são arquivos/textos ligados a um tópico (FK ON DELETE CASCADE).
  v0.2.0 cria via upload de PDF; v0.3+ adiciona url/paste.

  - `rawText` e `extractedConcepts` ficam null no momento do upload —
    são preenchidos pelo pipeline de ingestão (Fase E/F).
  - `contentHash` é SHA-256 do conteúdo, usado para dedup tanto em disco
    quanto a nível de tópico.

  v0.7.3: migrado pra Drizzle. JOIN + COUNT vira `leftJoin` + `count()`
  agregado; `groupBy(sources.id)` mantém a contagem por fonte.
*/

export type SourceFileType = 'pdf' | 'txt' | 'url' | 'paste';

export interface Source {
  id: string;
  topicId: string;
  filename: string;
  fileType: SourceFileType;
  contentHash: string;
  /** Caminho absoluto do arquivo em disco. */
  filePath: string;
  rawText: string | null;
  extractedConcepts: string | null;
  /** Número de chunks indexados. 0 enquanto o pipeline não rodou. */
  chunkCount: number;
  createdAt: string;
}

export interface CreateSourceInput {
  topicId: string;
  filename: string;
  fileType: SourceFileType;
  contentHash: string;
  filePath: string;
}

/*
  💡 Sources tem várias colunas opcionais no schema.sql (filename, file_type,
  content_hash, file_path) sem NOT NULL. Mas o app SEMPRE preenche essas
  colunas em createSource. Aceito retornar `string` (não `string | null`)
  na interface pública e usar `??` no normalize pra cobrir DBs com dados
  malformados (legacy).
*/
type SourceRow = typeof sources.$inferSelect & { chunkCount: number };

function normalize(row: SourceRow): Source {
  return {
    id: row.id,
    topicId: row.topicId,
    filename: row.filename ?? '',
    fileType: (row.fileType ?? 'pdf') as SourceFileType,
    contentHash: row.contentHash ?? '',
    filePath: row.filePath ?? '',
    rawText: row.rawText,
    extractedConcepts: row.extractedConcepts,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt,
  };
}

/*
  Helper: query base com LEFT JOIN em document_chunks + COUNT agregado.
  Drizzle: `count(documentChunks.id)` produz `COUNT(c.id)` no SQL.
  GROUP BY (sources.id) é obrigatório quando há agregação.

  💡 Drizzle infere o tipo do select shape automaticamente: campos do schema
  + count agregado. O `chunkCount` é `number` (count nunca é null em SQL).
*/
function selectSourceWithCount() {
  return getDrizzleDb()
    .select({
      id: sources.id,
      topicId: sources.topicId,
      filename: sources.filename,
      fileType: sources.fileType,
      contentHash: sources.contentHash,
      filePath: sources.filePath,
      rawText: sources.rawText,
      extractedConcepts: sources.extractedConcepts,
      createdAt: sources.createdAt,
      chunkCount: count(documentChunks.id),
    })
    .from(sources)
    .leftJoin(documentChunks, eq(documentChunks.sourceId, sources.id));
}

export function listSourcesByTopic(topicId: string): Source[] {
  const rows = selectSourceWithCount()
    .where(eq(sources.topicId, topicId))
    .groupBy(sources.id)
    .orderBy(sql`${sources.createdAt} DESC`)
    .all();
  return rows.map(normalize);
}

/**
 * Lista TODAS as sources (todos tópicos, todas matérias). Usada pelo escopo
 * global do chat (v0.8.0+) — RAG cobre tudo que o aluno subiu.
 */
export function listAllSources(): Source[] {
  const rows = selectSourceWithCount()
    .groupBy(sources.id)
    .orderBy(sql`${sources.createdAt} DESC`)
    .all();
  return rows.map(normalize);
}

export function getSource(id: string): Source | null {
  const row = selectSourceWithCount()
    .where(eq(sources.id, id))
    .groupBy(sources.id)
    .get();
  return row ? normalize(row) : null;
}

/**
 * Procura uma source com este `contentHash` dentro do tópico. Permite o handler
 * de upload pular criação quando o mesmo arquivo já está no tópico.
 */
export function findSourceByHash(topicId: string, contentHash: string): Source | null {
  const row = selectSourceWithCount()
    .where(
      and(
        eq(sources.topicId, topicId),
        eq(sources.contentHash, contentHash),
      ),
    )
    .groupBy(sources.id)
    .limit(1)
    .get();
  return row ? normalize(row) : null;
}

/**
 * Procura uma source **já processada** (com `raw_text` e chunks) que tenha o
 * mesmo `contentHash`, em qualquer tópico. Usado pelo pipeline de ingestão
 * pra detectar oportunidade de dedup: em vez de extrair/chunkar/embedar de
 * novo, copia os chunks da source existente.
 */
export function findProcessedSourceByHash(
  contentHash: string,
  exceptSourceId: string,
): Source | null {
  const row = selectSourceWithCount()
    .where(
      and(
        eq(sources.contentHash, contentHash),
        ne(sources.id, exceptSourceId),
        isNotNull(sources.rawText),
      ),
    )
    .groupBy(sources.id)
    .having(sql`count(${documentChunks.id}) > 0`)
    .orderBy(sql`${sources.createdAt} ASC`)
    .limit(1)
    .get();
  return row ? normalize(row) : null;
}

export function createSource(input: CreateSourceInput): Source {
  const id = randomUUID();
  const db = getDrizzleDb();
  db.insert(sources)
    .values({
      id,
      topicId: input.topicId,
      filename: input.filename,
      fileType: input.fileType,
      contentHash: input.contentHash,
      filePath: input.filePath,
    })
    .run();

  const created = getSource(id);
  if (!created) throw new Error('Falha ao recuperar source recém-criada');
  return created;
}

/**
 * Atualiza apenas os campos de processamento (rawText, extractedConcepts).
 * Usado pelo pipeline de ingestão depois que o texto é extraído.
 */
export function updateSourceProcessing(
  id: string,
  patch: { rawText?: string; extractedConcepts?: string },
): Source {
  const updates: Partial<typeof sources.$inferInsert> = {};
  if (patch.rawText !== undefined) updates.rawText = patch.rawText;
  if (patch.extractedConcepts !== undefined) {
    updates.extractedConcepts = patch.extractedConcepts;
  }

  if (Object.keys(updates).length === 0) {
    const existing = getSource(id);
    if (!existing) throw new Error(`Source ${id} não encontrada`);
    return existing;
  }

  const db = getDrizzleDb();
  db.update(sources).set(updates).where(eq(sources.id, id)).run();

  const updated = getSource(id);
  if (!updated) throw new Error(`Source ${id} sumiu durante update`);
  return updated;
}

export function deleteSource(id: string): void {
  const db = getDrizzleDb();
  const result = db.delete(sources).where(eq(sources.id, id)).run();
  if (result.changes === 0) {
    throw new Error(`Source ${id} não encontrada`);
  }
}

/**
 * Conta quantas sources distintas apontam para o mesmo file_path.
 * Usado antes de apagar um arquivo do disco — só removemos se for a última
 * referência (várias topics podem compartilhar o mesmo arquivo via dedup).
 */
export function countSourcesByFilePath(filePath: string): number {
  const db = getDrizzleDb();
  const row = db
    .select({ count: count() })
    .from(sources)
    .where(eq(sources.filePath, filePath))
    .get();
  return row?.count ?? 0;
}
