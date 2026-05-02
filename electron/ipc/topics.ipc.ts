import { ipcMain } from 'electron';
import {
  listTopicsBySubject,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
  type CreateTopicInput,
  type UpdateTopicInput,
} from '../database/repositories/topics.repo';
import { isObject } from '../utils/type-guards';

export function registerTopicsHandlers(): void {
  ipcMain.handle('topics:listBySubject', (_event, subjectId: unknown) => {
    if (typeof subjectId !== 'string') {
      throw new Error('topics:listBySubject exige subjectId (string)');
    }
    return listTopicsBySubject(subjectId);
  });

  ipcMain.handle('topics:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('topics:get exige id (string)');
    return getTopic(id);
  });

  ipcMain.handle('topics:create', (_event, input: unknown) => {
    return createTopic(parseCreateInput(input));
  });

  ipcMain.handle('topics:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('topics:update exige id (string)');
    return updateTopic(id, parseUpdateInput(patch));
  });

  ipcMain.handle('topics:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('topics:delete exige id (string)');
    deleteTopic(id);
  });
}

function parseCreateInput(value: unknown): CreateTopicInput {
  if (!isObject(value)) throw new Error('topics:create exige um objeto');

  const subjectId = value['subjectId'];
  if (typeof subjectId !== 'string') throw new Error('Campo "subjectId" é obrigatório');

  const name = value['name'];
  if (typeof name !== 'string') throw new Error('Campo "name" é obrigatório');

  const description = value['description'];
  if (description !== undefined && typeof description !== 'string') {
    throw new Error('Campo "description" deve ser string');
  }

  return { subjectId, name, description };
}

function parseUpdateInput(value: unknown): UpdateTopicInput {
  if (!isObject(value)) throw new Error('topics:update exige um objeto patch');

  const patch: UpdateTopicInput = {};

  if (value['name'] !== undefined) {
    if (typeof value['name'] !== 'string') throw new Error('Campo "name" deve ser string');
    patch.name = value['name'];
  }
  // description aceita string OU null (null = limpar a descrição)
  if (value['description'] !== undefined) {
    if (value['description'] !== null && typeof value['description'] !== 'string') {
      throw new Error('Campo "description" deve ser string ou null');
    }
    patch.description = value['description'];
  }

  return patch;
}
