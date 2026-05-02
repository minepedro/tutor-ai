import { ipcMain } from 'electron';
import {
  listSourcesByTopic,
  getSource,
} from '../database/repositories/sources.repo';

/*
  Handlers read-only de sources. As operações que envolvem efeitos colaterais
  no disco (upload, delete) vivem em `files.ipc.ts`. Aqui só leitura.
*/
export function registerSourcesHandlers(): void {
  ipcMain.handle('sources:listByTopic', (_event, topicId: unknown) => {
    if (typeof topicId !== 'string') {
      throw new Error('sources:listByTopic exige topicId (string)');
    }
    return listSourcesByTopic(topicId);
  });

  ipcMain.handle('sources:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('sources:get exige id (string)');
    return getSource(id);
  });
}
