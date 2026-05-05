import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  listTopicsBySubject,
  getTopic,
  createTopic,
  updateTopic,
  deleteTopic,
} from '../database/repositories/topics.repo';
import { IdSchema, parseInput } from './schemas';

const CreateTopicSchema = z.object({
  subjectId: IdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
});

// description aceita string OU null (null = limpar)
const UpdateTopicSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

const UpdateArgsSchema = z.object({
  id: IdSchema,
  patch: UpdateTopicSchema,
});

export function registerTopicsHandlers(): void {
  ipcMain.handle('topics:listBySubject', (_event, subjectId: unknown) => {
    return listTopicsBySubject(parseInput(IdSchema, subjectId));
  });

  ipcMain.handle('topics:get', (_event, id: unknown) => {
    return getTopic(parseInput(IdSchema, id));
  });

  ipcMain.handle('topics:create', (_event, input: unknown) => {
    return createTopic(parseInput(CreateTopicSchema, input));
  });

  ipcMain.handle('topics:update', (_event, id: unknown, patch: unknown) => {
    const parsed = parseInput(UpdateArgsSchema, { id, patch });
    return updateTopic(parsed.id, parsed.patch);
  });

  ipcMain.handle('topics:delete', (_event, id: unknown) => {
    deleteTopic(parseInput(IdSchema, id));
  });
}
