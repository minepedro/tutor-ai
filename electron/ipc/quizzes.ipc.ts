import { ipcMain, BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  createQuiz,
  getQuiz,
  listQuizzesByTopic,
  answerQuestion,
  finishQuiz,
  deleteQuiz,
  resetQuiz,
  renameQuiz,
} from '../database/repositories/quizzes.repo';
import { generateQuiz, suggestThemes } from '../services/quiz-generator.service';
import { getTopic } from '../database/repositories/topics.repo';
import {
  IdSchema,
  NonEmptyStringArraySchema,
  parseInput,
} from './schemas';

/*
  Handlers do quiz. O `quizzes:generate` é o ponto crítico: chama o pipeline
  de 3 etapas (análise → geração → validação) e depois persiste. Reporta
  progresso via webContents.send (mesmo padrão de embeddings).
*/

// ── Schemas Zod ─────────────────────────────────────────────────────────

const GenerateQuizSchema = z.object({
  topicId: IdSchema,
  sourceIds: NonEmptyStringArraySchema,
  count: z.number().int().min(3).max(30),
  types: z.enum(['multiple_choice', 'true_false', 'mixed']),
  themeFilter: z.string().trim().optional(),
  title: z.string().optional(),
});

const AnswerQuestionSchema = z.object({
  questionId: IdSchema,
  selectedIndex: z.number().int().nonnegative(),
});

const FinishQuizSchema = z.object({
  quizId: IdSchema,
  timeSpentSeconds: z.number().nonnegative().finite(),
});

const RenameQuizSchema = z.object({
  id: IdSchema,
  title: z.string(),
});

export function registerQuizzesHandlers(): void {
  ipcMain.handle('quizzes:generate', async (event, input: unknown) => {
    const params = parseInput(GenerateQuizSchema, input);

    // Tópico tem que existir.
    const topic = getTopic(params.topicId);
    if (!topic) throw new Error(`Tópico ${params.topicId} não encontrado`);

    const win = BrowserWindow.fromWebContents(event.sender);
    const reportProgress = (pct: number, status: string) => {
      win?.webContents.send('quizzes:progress', { pct, status });
    };

    // Quiz mode: hardcoded 'quality' na v0.3.0 (ADR diz: sem modo quick).
    const quizMode = 'quality' as const;

    const themeFilter =
      params.themeFilter && params.themeFilter.length > 0
        ? params.themeFilter
        : undefined;

    const result = await generateQuiz(
      {
        sourceIds: params.sourceIds,
        count: params.count,
        types: params.types,
        ...(themeFilter ? { themeFilter } : {}),
      },
      reportProgress,
    );

    // Tema não matched → não persiste, retorna sentinela pra UI.
    if (!result.themeMatched) {
      return {
        quiz: null,
        totalGenerated: 0,
        totalValidated: 0,
        themeMatched: false,
      };
    }

    // Fica null se múltiplas sources (quiz "transversal" do tópico).
    const sourceId = params.sourceIds.length === 1 ? params.sourceIds[0]! : null;

    const quiz = createQuiz({
      topicId: params.topicId,
      sourceId,
      title: params.title ?? null,
      quizMode,
      questions: result.questions.map((q) => ({
        type: q.type,
        difficulty: q.difficulty,
        question: q.question,
        options: q.options,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
      })),
    });

    return {
      quiz,
      totalGenerated: result.totalGenerated,
      totalValidated: result.totalValidated,
      themeMatched: true,
    };
  });

  ipcMain.handle('quizzes:suggestThemes', async (_event, sourceIds: unknown) => {
    const parsed = parseInput(NonEmptyStringArraySchema, sourceIds);
    return suggestThemes(parsed);
  });

  ipcMain.handle('quizzes:get', (_event, id: unknown) => {
    return getQuiz(parseInput(IdSchema, id));
  });

  ipcMain.handle('quizzes:listByTopic', (_event, topicId: unknown) => {
    return listQuizzesByTopic(parseInput(IdSchema, topicId));
  });

  ipcMain.handle(
    'quizzes:answer',
    (_event, questionId: unknown, selectedIndex: unknown) => {
      const parsed = parseInput(AnswerQuestionSchema, {
        questionId,
        selectedIndex,
      });
      return answerQuestion(parsed.questionId, parsed.selectedIndex);
    },
  );

  ipcMain.handle(
    'quizzes:finish',
    (_event, quizId: unknown, timeSpentSeconds: unknown) => {
      const parsed = parseInput(FinishQuizSchema, { quizId, timeSpentSeconds });
      return finishQuiz(parsed.quizId, Math.round(parsed.timeSpentSeconds));
    },
  );

  ipcMain.handle('quizzes:delete', (_event, id: unknown) => {
    deleteQuiz(parseInput(IdSchema, id));
  });

  ipcMain.handle('quizzes:reset', (_event, id: unknown) => {
    return resetQuiz(parseInput(IdSchema, id));
  });

  ipcMain.handle('quizzes:rename', (_event, id: unknown, title: unknown) => {
    const parsed = parseInput(RenameQuizSchema, { id, title });
    return renameQuiz(parsed.id, parsed.title);
  });
}
