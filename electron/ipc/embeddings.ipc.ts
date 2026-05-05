import { ipcMain, BrowserWindow } from 'electron';
import { ingestSource } from '../services/ingestion.service';
import { countChunksBySource } from '../database/repositories/chunks.repo';
import { IdSchema, parseInput } from './schemas';

/*
  IPC para o pipeline de ingestão. Mesmo padrão de progresso do setup.ipc.ts:
  o handler manda eventos via webContents.send e o renderer escuta no preload.

  O canal de progresso carrega o sourceId pra que a UI possa mostrar o estado
  de várias ingestões simultâneas (se isso virar requisito) — hoje só roda
  uma por vez, mas o protocolo já está preparado.
*/
export function registerEmbeddingsHandlers(): void {
  ipcMain.handle('embeddings:ingest', async (event, sourceId: unknown) => {
    const id = parseInput(IdSchema, sourceId);

    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await ingestSource(id, (pct, status) => {
      win?.webContents.send('embeddings:progress', { sourceId: id, pct, status });
    });

    return result;
  });

  ipcMain.handle('embeddings:countBySource', (_event, sourceId: unknown) => {
    return countChunksBySource(parseInput(IdSchema, sourceId));
  });
}
