import { ipcMain, app, BrowserWindow } from 'electron';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { isModelReady, getModelPath } from '../services/embedding.service';

/*
  Baixar o modelo ONNX envolve uma operação longa com progresso incremental.
  Funções não são serializáveis em JSON, então não dá para passar um callback
  de progresso via ipcRenderer.invoke(). O padrão correto no Electron é:

    main → renderer: webContents.send('setup:progress', { pct, status })
    renderer: ipcRenderer.on('setup:progress', handler)

  O renderer chama invoke('setup:downloadModel') para iniciar, recebe eventos
  de progresso via on('setup:progress'), e a Promise resolve quando termina.
*/

const MODEL_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';

async function downloadModel(win: BrowserWindow): Promise<void> {
  const modelPath = getModelPath();
  const modelDir = join(app.getPath('userData'), 'models');

  if (!existsSync(modelDir)) mkdirSync(modelDir, { recursive: true });
  if (existsSync(modelPath)) return; // já baixado

  await downloadWithProgress(MODEL_URL, modelPath, (pct, status) => {
    win.webContents.send('setup:progress', { pct, status });
  });
}

function downloadWithProgress(
  url: string,
  dest: string,
  onProgress: (pct: number, status: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    const request = get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers['location'];
        if (!location) return reject(new Error('Redirect sem Location header'));
        file.close();
        downloadWithProgress(location, dest, onProgress).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let downloaded = 0;

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          onProgress(pct, `Baixando… ${pct}% (${(downloaded / 1e6).toFixed(1)} MB)`);
        }
      });

      pipeline(res, file)
        .then(() => {
          onProgress(100, 'Download concluído!');
          resolve();
        })
        .catch(reject);
    });

    request.on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

export function registerSetupHandlers(): void {
  ipcMain.handle('setup:isModelReady', () => isModelReady());

  ipcMain.handle('setup:downloadModel', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('BrowserWindow não encontrada');
    await downloadModel(win);
  });
}
