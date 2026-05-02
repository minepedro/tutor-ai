import { ipcMain } from 'electron';
import {
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
  type CreateSubjectInput,
  type UpdateSubjectInput,
} from '../database/repositories/subjects.repo';
import { isObject } from '../utils/type-guards';

export function registerSubjectsHandlers(): void {
  ipcMain.handle('subjects:list', () => listSubjects());

  ipcMain.handle('subjects:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:get exige id (string)');
    return getSubject(id);
  });

  ipcMain.handle('subjects:create', (_event, input: unknown) => {
    return createSubject(parseCreateInput(input));
  });

  ipcMain.handle('subjects:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:update exige id (string)');
    return updateSubject(id, parseUpdateInput(patch));
  });

  ipcMain.handle('subjects:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:delete exige id (string)');
    deleteSubject(id);
  });
}

function parseCreateInput(value: unknown): CreateSubjectInput {
  if (!isObject(value)) throw new Error('subjects:create exige um objeto');

  const name = value['name'];
  if (typeof name !== 'string') throw new Error('Campo "name" é obrigatório');

  const color = value['color'];
  if (color !== undefined && typeof color !== 'string') {
    throw new Error('Campo "color" deve ser string');
  }

  const emoji = value['emoji'];
  if (emoji !== undefined && typeof emoji !== 'string') {
    throw new Error('Campo "emoji" deve ser string');
  }

  return { name, color, emoji };
}

function parseUpdateInput(value: unknown): UpdateSubjectInput {
  if (!isObject(value)) throw new Error('subjects:update exige um objeto patch');

  const patch: UpdateSubjectInput = {};

  if (value['name'] !== undefined) {
    if (typeof value['name'] !== 'string') throw new Error('Campo "name" deve ser string');
    patch.name = value['name'];
  }
  if (value['color'] !== undefined) {
    if (typeof value['color'] !== 'string') throw new Error('Campo "color" deve ser string');
    patch.color = value['color'];
  }
  if (value['emoji'] !== undefined) {
    if (typeof value['emoji'] !== 'string') throw new Error('Campo "emoji" deve ser string');
    patch.emoji = value['emoji'];
  }

  return patch;
}
