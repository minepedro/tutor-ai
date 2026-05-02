import { ipcMain, BrowserWindow } from 'electron';
import { ingestSource } from '../services/ingestion.service';
import { countChunksBySource } from '../database/repositories/chunks.repo';

/*
  IPC para o pipeline de ingestão. Mesmo padrão de progresso do setup.ipc.ts:
  o handler manda eventos via webContents.send e o renderer escuta no preload.

  O canal de progresso carrega o sourceId pra que a UI possa mostrar o estado
  de várias ingestões simultâneas (se isso virar requisito) — hoje só roda
  uma por vez, mas o protocolo já está preparado.
*/
export function registerEmbeddingsHandlers(): void {
  ipcMain.handle('embeddings:ingest', async (event, sourceId: unknown) => {
    if (typeof sourceId !== 'string') {
      throw new Error('embeddings:ingest exige sourceId (string)');
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await ingestSource(sourceId, (pct, status) => {
      win?.webContents.send('embeddings:progress', { sourceId, pct, status });
    });

    return result;
  });

  ipcMain.handle('embeddings:countBySource', (_event, sourceId: unknown) => {
    if (typeof sourceId !== 'string') {
      throw new Error('embeddings:countBySource exige sourceId (string)');
    }
    return countChunksBySource(sourceId);
  });
}
