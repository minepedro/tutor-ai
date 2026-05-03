import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { getDb, closeDb } from './database/connection';
import { initChunksTable } from './database/lancedb';
import { registerSettingsHandlers } from './ipc/settings.ipc';
import { registerSetupHandlers } from './ipc/setup.ipc';
import { registerSubjectsHandlers } from './ipc/subjects.ipc';
import { registerTopicsHandlers } from './ipc/topics.ipc';
import { registerSourcesHandlers } from './ipc/sources.ipc';
import { registerFilesHandlers } from './ipc/files.ipc';
import { registerEmbeddingsHandlers } from './ipc/embeddings.ipc';
import { registerQuizzesHandlers } from './ipc/quizzes.ipc';
import { registerChatHandlers } from './ipc/chat.ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#08080d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Em dev, electron-vite injeta a URL do servidor Vite. Em prod, carrega o
  // bundle estático que o build gerou.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Bloqueia abrir links externos dentro do app — abre no browser do SO.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function configureCsp(): void {
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline'/'unsafe-eval' só em dev para o HMR do Vite funcionar.
      `script-src 'self'${isDev ? " 'unsafe-inline' 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' https://api.anthropic.com${
        isDev ? ' ws://localhost:* http://localhost:*' : ''
      }`,
    ].join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPlatform', () => process.platform);
  registerSettingsHandlers();
  registerSetupHandlers();
  registerSubjectsHandlers();
  registerTopicsHandlers();
  registerSourcesHandlers();
  registerFilesHandlers();
  registerEmbeddingsHandlers();
  registerQuizzesHandlers();
  registerChatHandlers();
}

app.whenReady().then(async () => {
  getDb(); // inicializa o banco SQLite e cria as tabelas
  await initChunksTable(); // inicializa a tabela de vetores no LanceDB
  configureCsp();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => closeDb());
