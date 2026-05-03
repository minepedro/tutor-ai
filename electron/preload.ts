import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcApi } from '@shared/ipc';

const api: IpcApi = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
  settings: {
    saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
    loadApiKey: () => ipcRenderer.invoke('settings:loadApiKey'),
    getEncryptionStatus: () => ipcRenderer.invoke('settings:getEncryptionStatus'),
    clearAll: () => ipcRenderer.invoke('settings:clearAll'),
  },
  subjects: {
    list: () => ipcRenderer.invoke('subjects:list'),
    get: (id) => ipcRenderer.invoke('subjects:get', id),
    create: (input) => ipcRenderer.invoke('subjects:create', input),
    update: (id, patch) => ipcRenderer.invoke('subjects:update', id, patch),
    delete: (id) => ipcRenderer.invoke('subjects:delete', id),
  },
  topics: {
    listBySubject: (subjectId) => ipcRenderer.invoke('topics:listBySubject', subjectId),
    get: (id) => ipcRenderer.invoke('topics:get', id),
    create: (input) => ipcRenderer.invoke('topics:create', input),
    update: (id, patch) => ipcRenderer.invoke('topics:update', id, patch),
    delete: (id) => ipcRenderer.invoke('topics:delete', id),
  },
  sources: {
    listByTopic: (topicId) => ipcRenderer.invoke('sources:listByTopic', topicId),
    get: (id) => ipcRenderer.invoke('sources:get', id),
  },
  files: {
    pickAndUpload: (topicId) => ipcRenderer.invoke('files:pickAndUpload', topicId),
    uploadFromPaths: (topicId, paths) =>
      ipcRenderer.invoke('files:uploadFromPaths', topicId, paths),
    deleteSource: (sourceId) => ipcRenderer.invoke('files:deleteSource', sourceId),
    /*
      💡 Resolve o caminho absoluto de um File arrastado do SO. Em Electron 32+
      `file.path` foi removido; webUtils.getPathForFile é o substituto oficial.
      Precisa rodar no mesmo process que recebeu o evento de drag — o preload
      compartilha o renderer process então isso funciona aqui.
    */
    getDroppedPath: (file) => webUtils.getPathForFile(file),
  },
  embeddings: {
    ingest: (sourceId) => ipcRenderer.invoke('embeddings:ingest', sourceId),
    countBySource: (sourceId) => ipcRenderer.invoke('embeddings:countBySource', sourceId),
    onProgress: (callback) => {
      type ProgressData = { sourceId: string; pct: number; status: string };
      const handler = (_event: Electron.IpcRendererEvent, data: ProgressData) => {
        callback(data);
      };
      ipcRenderer.on('embeddings:progress', handler);
      return () => ipcRenderer.off('embeddings:progress', handler);
    },
  },
  quizzes: {
    generate: (input) => ipcRenderer.invoke('quizzes:generate', input),
    suggestThemes: (sourceIds) => ipcRenderer.invoke('quizzes:suggestThemes', sourceIds),
    get: (id) => ipcRenderer.invoke('quizzes:get', id),
    listByTopic: (topicId) => ipcRenderer.invoke('quizzes:listByTopic', topicId),
    answer: (questionId, selectedIndex) =>
      ipcRenderer.invoke('quizzes:answer', questionId, selectedIndex),
    finish: (quizId, timeSpentSeconds) =>
      ipcRenderer.invoke('quizzes:finish', quizId, timeSpentSeconds),
    delete: (id) => ipcRenderer.invoke('quizzes:delete', id),
    reset: (id) => ipcRenderer.invoke('quizzes:reset', id),
    rename: (id, title) => ipcRenderer.invoke('quizzes:rename', id, title),
    onProgress: (callback) => {
      type ProgressData = { pct: number; status: string };
      const handler = (_event: Electron.IpcRendererEvent, data: ProgressData) => {
        callback(data);
      };
      ipcRenderer.on('quizzes:progress', handler);
      return () => ipcRenderer.off('quizzes:progress', handler);
    },
  },
  setup: {
    downloadModel: () => ipcRenderer.invoke('setup:downloadModel'),
    isModelReady: () => ipcRenderer.invoke('setup:isModelReady'),

    /*
      onProgress usa ipcRenderer.on() — o único jeito de receber eventos
      "empurrados" pelo main (webContents.send). O handler é registrado aqui
      no preload e o callback é repassado ao renderer via contextBridge de
      forma segura (sem vazar o ipcRenderer para o lado renderer).

      Retorna uma função de cleanup para remover o listener quando o
      componente desmonta (evita memory leak e callbacks duplicados).
    */
    onProgress: (callback) => {
      type ProgressData = { pct: number; status: string };
      const handler = (_event: Electron.IpcRendererEvent, data: ProgressData) => {
        callback(data.pct, data.status);
      };
      ipcRenderer.on('setup:progress', handler);
      return () => ipcRenderer.off('setup:progress', handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
