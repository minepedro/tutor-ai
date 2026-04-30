import { ipcMain, app } from 'electron';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  saveApiKey,
  loadApiKey,
  hasApiKey,
  deleteApiKey,
  getEncryptionStatus,
} from '../utils/crypto';
import { closeDb } from '../database/connection';

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:saveApiKey', (_event, key: string) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('API key inválida');
    }
    saveApiKey(key.trim());
  });

  ipcMain.handle('settings:hasApiKey', () => hasApiKey());

  ipcMain.handle('settings:loadApiKey', () => loadApiKey());

  ipcMain.handle('settings:getEncryptionStatus', () => getEncryptionStatus());

  ipcMain.handle('settings:clearAll', () => {
    const userData = app.getPath('userData');

    // Fecha o banco antes de deletar o arquivo.
    closeDb();

    const targets = [
      join(userData, 'database.db'),
      join(userData, 'database.db-wal'),
      join(userData, 'database.db-shm'),
      join(userData, 'embeddings'),
      join(userData, 'sources'),
      join(userData, 'models'),
    ];

    for (const target of targets) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
    }

    deleteApiKey();
  });
}
