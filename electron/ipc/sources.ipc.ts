import { ipcMain } from 'electron';
import {
  listSourcesByTopic,
  getSource,
} from '../database/repositories/sources.repo';
import { IdSchema, parseInput } from './schemas';

/*
  Handlers read-only de sources. As operações que envolvem efeitos colaterais
  no disco (upload, delete) vivem em `files.ipc.ts`. Aqui só leitura.
*/
export function registerSourcesHandlers(): void {
  ipcMain.handle('sources:listByTopic', (_event, topicId: unknown) => {
    return listSourcesByTopic(parseInput(IdSchema, topicId));
  });

  ipcMain.handle('sources:get', (_event, id: unknown) => {
    return getSource(parseInput(IdSchema, id));
  });
}
