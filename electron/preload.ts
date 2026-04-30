import { contextBridge, ipcRenderer } from 'electron';
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
