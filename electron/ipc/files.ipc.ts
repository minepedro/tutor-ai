import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import {
  createSource,
  findSourceByHash,
  getSource,
  countSourcesByFilePath,
  deleteSource,
  type Source,
  type SourceFileType,
} from '../database/repositories/sources.repo';
import { getTopic } from '../database/repositories/topics.repo';
import { deleteChunkVectorsBySource } from '../database/repositories/chunks.repo';
import { IdSchema, NonEmptyStringArraySchema, parseInput } from './schemas';

const UploadFromPathsSchema = z.object({
  topicId: IdSchema,
  paths: NonEmptyStringArraySchema,
});

/*
  Upload de arquivos. Estratégia:

  1. Mostra dialog de seleção (filtro: PDF na v0.2.0).
  2. Lê o arquivo, calcula SHA-256 do conteúdo.
  3. Se já existe source com este hash neste tópico → retorna ela (idempotência).
  4. Senão, copia para userData/sources/<hash>.<ext> (cria diretório se não existe;
     pula a cópia se já existe um arquivo com esse hash, porque o conteúdo é igual).
  5. Insere linha em `sources` apontando para o file_path.

  💡 O SHA-256 dedupa em DOIS níveis: arquivo no disco (uma cópia por conteúdo
  único, mesmo que diferentes tópicos referenciem) e linha no banco (mesmo arquivo
  no mesmo tópico = mesma linha).
*/

const ACCEPTED_EXTENSIONS = ['.pdf'];

export function registerFilesHandlers(): void {
  /*
    Abre o dialog do SO em multi-select (Ctrl/Shift). Retorna a lista de
    sources processadas (pode ser vazia se cancelou ou nada foi escolhido).
  */
  ipcMain.handle('files:pickAndUpload', async (event, topicId: unknown) => {
    const id = parseInput(IdSchema, topicId);

    const topic = getTopic(id);
    if (!topic) throw new Error(`Tópico ${id} não encontrado`);

    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: 'Escolher PDFs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return uploadFiles(id, result.filePaths);
  });

  /*
    Variante para drag-and-drop: o renderer já tem os caminhos (resolvidos
    via webUtils.getPathForFile no preload). Mesma lógica de upload em série.
  */
  ipcMain.handle('files:uploadFromPaths', async (_event, topicId: unknown, paths: unknown) => {
    const parsed = parseInput(UploadFromPathsSchema, { topicId, paths });

    const topic = getTopic(parsed.topicId);
    if (!topic) throw new Error(`Tópico ${parsed.topicId} não encontrado`);

    return uploadFiles(parsed.topicId, parsed.paths);
  });

  ipcMain.handle('files:deleteSource', async (_event, sourceId: unknown) => {
    const id = parseInput(IdSchema, sourceId);

    const source = getSource(id);
    if (!source) throw new Error(`Source ${id} não encontrada`);

    // 1. LanceDB primeiro (não tem FK cascade — precisa explicit cleanup).
    await deleteChunkVectorsBySource(id);

    // 2. Apaga a linha em sources (CASCADE limpa document_chunks no SQLite).
    deleteSource(id);

    // 3. Se nenhuma outra source referencia este arquivo no disco, apaga.
    if (countSourcesByFilePath(source.filePath) === 0 && existsSync(source.filePath)) {
      await unlink(source.filePath).catch(() => {
        // best-effort; arquivo órfão é melhor que crashar o handler
      });
    }
  });
}

/*
  Upload em série de N arquivos. Falhar num arquivo não aborta os outros —
  cada um vira um resultado independente (success ou skipped por erro), e
  retornamos a lista das sources que conseguiram entrar.
*/
async function uploadFiles(topicId: string, paths: string[]): Promise<Source[]> {
  const results: Source[] = [];
  for (const path of paths) {
    try {
      results.push(await uploadFile(topicId, path));
    } catch (err) {
      // Loga e segue. UI pode ver o erro pelo throw do handler global se quiser.
      console.error(`Falha ao subir ${path}:`, err);
    }
  }
  return results;
}

async function uploadFile(topicId: string, sourcePath: string): Promise<Source> {
  const ext = extname(sourcePath).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Tipo de arquivo não suportado: ${ext}. Por enquanto só PDF.`);
  }

  // Sanity: o arquivo existe e é legível.
  await stat(sourcePath);

  // Lê uma vez para calcular hash. PDFs raramente são gigantes (<50MB), então
  // ler tudo em memória é aceitável. Se virar problema, trocar por stream.
  const buffer = await readFile(sourcePath);
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // Já existe no tópico? Retorna idempotente.
  const existing = findSourceByHash(topicId, contentHash);
  if (existing) return existing;

  // Garante o diretório userData/sources/
  const sourcesDir = join(app.getPath('userData'), 'sources');
  if (!existsSync(sourcesDir)) {
    await mkdir(sourcesDir, { recursive: true });
  }

  const destPath = join(sourcesDir, `${contentHash}${ext}`);

  // Se outro tópico já tinha este arquivo, o file físico já existe — só não copia.
  if (!existsSync(destPath)) {
    await copyFile(sourcePath, destPath);
  }

  return createSource({
    topicId,
    filename: basename(sourcePath),
    fileType: extToFileType(ext),
    contentHash,
    filePath: destPath,
  });
}

function extToFileType(ext: string): SourceFileType {
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.txt':
      return 'txt';
    default:
      // Já validado em ACCEPTED_EXTENSIONS, mas o switch precisa ser exaustivo.
      throw new Error(`Extensão não mapeada: ${ext}`);
  }
}
