import { ipcMain } from 'electron';
import { z } from 'zod';
import {
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  deleteSubject,
} from '../database/repositories/subjects.repo';
import { IdSchema, parseInput } from './schemas';

const CreateSubjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  emoji: z.string().optional(),
});

const UpdateSubjectSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  emoji: z.string().optional(),
});

const UpdateArgsSchema = z.object({
  id: IdSchema,
  patch: UpdateSubjectSchema,
});

export function registerSubjectsHandlers(): void {
  ipcMain.handle('subjects:list', () => listSubjects());

  ipcMain.handle('subjects:get', (_event, id: unknown) => {
    return getSubject(parseInput(IdSchema, id));
  });

  ipcMain.handle('subjects:create', (_event, input: unknown) => {
    return createSubject(parseInput(CreateSubjectSchema, input));
  });

  ipcMain.handle('subjects:update', (_event, id: unknown, patch: unknown) => {
    const parsed = parseInput(UpdateArgsSchema, { id, patch });
    return updateSubject(parsed.id, parsed.patch);
  });

  ipcMain.handle('subjects:delete', (_event, id: unknown) => {
    deleteSubject(parseInput(IdSchema, id));
  });
}
