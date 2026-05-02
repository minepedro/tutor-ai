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
import {
  listTopicsBySubject,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
  type CreateTopicInput,
  type UpdateTopicInput,
} from '../database/repositories/topics.repo';
import {
  listSourcesByTopic,
  getSource,
} from '../database/repositories/sources.repo';

/*
  Handlers de CRUD do banco. Mantém validação leve (só formato/presença);
  validação de regras de negócio fica no repo. Ao crescer (sources, chunks),
  basta adicionar mais blocos abaixo.

  💡 Os argumentos vêm como `unknown` na superfície — checagens explícitas
  protegem o main de payloads malformados que cheguem por IPC.
*/
export function registerDatabaseHandlers(): void {
  // ── subjects ────────────────────────────────────────────────────────────
  ipcMain.handle('subjects:list', () => listSubjects());

  ipcMain.handle('subjects:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:get exige id (string)');
    return getSubject(id);
  });

  ipcMain.handle('subjects:create', (_event, input: unknown) => {
    return createSubject(parseSubjectCreateInput(input));
  });

  ipcMain.handle('subjects:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:update exige id (string)');
    return updateSubject(id, parseSubjectUpdateInput(patch));
  });

  ipcMain.handle('subjects:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('subjects:delete exige id (string)');
    deleteSubject(id);
  });

  // ── topics ──────────────────────────────────────────────────────────────
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
    return createTopic(parseTopicCreateInput(input));
  });

  ipcMain.handle('topics:update', (_event, id: unknown, patch: unknown) => {
    if (typeof id !== 'string') throw new Error('topics:update exige id (string)');
    return updateTopic(id, parseTopicUpdateInput(patch));
  });

  ipcMain.handle('topics:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('topics:delete exige id (string)');
    deleteTopic(id);
  });

  // ── sources (read-only — criação/exclusão envolvem arquivos, vão em files.ipc.ts) ──
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

/*
  Type guards manuais. Numa codebase maior usaria zod/valibot, mas pra v0.2.0
  isso aqui é suficiente — checa que cada campo, se presente, tem o tipo certo.
*/
function parseSubjectCreateInput(value: unknown): CreateSubjectInput {
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

function parseSubjectUpdateInput(value: unknown): UpdateSubjectInput {
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

function parseTopicCreateInput(value: unknown): CreateTopicInput {
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

function parseTopicUpdateInput(value: unknown): UpdateTopicInput {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
