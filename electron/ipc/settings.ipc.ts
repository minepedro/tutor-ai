import { ipcMain, app } from 'electron';
import { z } from 'zod';
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
import { resetClaudeClient } from '../services/claude.service';
import { getSecretStorage, getUserDataPath } from '../main';
import { parseInput } from './schemas';

const ApiKeySchema = z
  .string()
  .min(1, 'API key não pode ficar vazia')
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, 'API key não pode ficar vazia');

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:saveApiKey', (_event, key: unknown) => {
    const trimmed = parseInput(ApiKeySchema, key);
    saveApiKey(getSecretStorage(), getUserDataPath(), trimmed);
    // Cliente cacheado fica stale ao trocar a chave — descarta pra recriar.
    resetClaudeClient();
  });

  ipcMain.handle('settings:hasApiKey', () =>
    hasApiKey(getSecretStorage(), getUserDataPath()),
  );

  ipcMain.handle('settings:loadApiKey', () =>
    loadApiKey(getSecretStorage(), getUserDataPath()),
  );

  ipcMain.handle('settings:getEncryptionStatus', () =>
    getEncryptionStatus(getSecretStorage()),
  );

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

    deleteApiKey(userData);
    resetClaudeClient();
  });
}
