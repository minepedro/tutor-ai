import { ipcMain, BrowserWindow } from 'electron';
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
import { isObject } from '../utils/type-guards';

/*
  Handlers do quiz. O `quizzes:generate` é o ponto crítico: chama o pipeline
  de 3 etapas (análise → geração → validação) e depois persiste. Reporta
  progresso via webContents.send (mesmo padrão de embeddings).
*/

export function registerQuizzesHandlers(): void {
  ipcMain.handle('quizzes:generate', async (event, input: unknown) => {
    const params = parseGenerateInput(input);

    // Tópico tem que existir.
    const topic = getTopic(params.topicId);
    if (!topic) throw new Error(`Tópico ${params.topicId} não encontrado`);

    const win = BrowserWindow.fromWebContents(event.sender);
    const reportProgress = (pct: number, status: string) => {
      win?.webContents.send('quizzes:progress', { pct, status });
    };

    // Quiz mode: hardcoded 'quality' na v0.3.0 (ADR diz: sem modo quick).
    const quizMode = 'quality' as const;

    const result = await generateQuiz(
      {
        sourceIds: params.sourceIds,
        count: params.count,
        types: params.types,
        ...(params.themeFilter ? { themeFilter: params.themeFilter } : {}),
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
    if (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== 'string')) {
      throw new Error('quizzes:suggestThemes exige sourceIds (string[])');
    }
    return suggestThemes(sourceIds);
  });

  ipcMain.handle('quizzes:get', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('quizzes:get exige id (string)');
    return getQuiz(id);
  });

  ipcMain.handle('quizzes:listByTopic', (_event, topicId: unknown) => {
    if (typeof topicId !== 'string') {
      throw new Error('quizzes:listByTopic exige topicId (string)');
    }
    return listQuizzesByTopic(topicId);
  });

  ipcMain.handle('quizzes:answer', (_event, questionId: unknown, selectedIndex: unknown) => {
    if (typeof questionId !== 'string') {
      throw new Error('quizzes:answer exige questionId (string)');
    }
    if (
      typeof selectedIndex !== 'number' ||
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0
    ) {
      throw new Error('quizzes:answer exige selectedIndex (inteiro >= 0)');
    }
    return answerQuestion(questionId, selectedIndex);
  });

  ipcMain.handle('quizzes:finish', (_event, quizId: unknown, timeSpentSeconds: unknown) => {
    if (typeof quizId !== 'string') {
      throw new Error('quizzes:finish exige quizId (string)');
    }
    if (
      typeof timeSpentSeconds !== 'number' ||
      !Number.isFinite(timeSpentSeconds) ||
      timeSpentSeconds < 0
    ) {
      throw new Error('quizzes:finish exige timeSpentSeconds (number >= 0)');
    }
    return finishQuiz(quizId, Math.round(timeSpentSeconds));
  });

  ipcMain.handle('quizzes:delete', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('quizzes:delete exige id (string)');
    deleteQuiz(id);
  });

  ipcMain.handle('quizzes:reset', (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('quizzes:reset exige id (string)');
    return resetQuiz(id);
  });

  ipcMain.handle('quizzes:rename', (_event, id: unknown, title: unknown) => {
    if (typeof id !== 'string') throw new Error('quizzes:rename exige id (string)');
    if (typeof title !== 'string') throw new Error('quizzes:rename exige title (string)');
    return renameQuiz(id, title);
  });
}

interface ParsedGenerateInput {
  topicId: string;
  sourceIds: string[];
  count: number;
  types: 'multiple_choice' | 'true_false' | 'mixed';
  themeFilter?: string;
  title?: string;
}

function parseGenerateInput(value: unknown): ParsedGenerateInput {
  if (!isObject(value)) throw new Error('quizzes:generate exige um objeto');

  const topicId = value['topicId'];
  if (typeof topicId !== 'string') throw new Error('topicId é obrigatório');

  const sourceIds = value['sourceIds'];
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.length === 0 ||
    sourceIds.some((s) => typeof s !== 'string')
  ) {
    throw new Error('sourceIds deve ser array não-vazio de strings');
  }

  const count = value['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 3 || count > 30) {
    throw new Error('count deve ser inteiro entre 3 e 30');
  }

  const types = value['types'];
  if (types !== 'multiple_choice' && types !== 'true_false' && types !== 'mixed') {
    throw new Error('types inválido');
  }

  const themeFilter = value['themeFilter'];
  if (themeFilter !== undefined && typeof themeFilter !== 'string') {
    throw new Error('themeFilter deve ser string');
  }

  const title = value['title'];
  if (title !== undefined && typeof title !== 'string') {
    throw new Error('title deve ser string');
  }

  return {
    topicId,
    sourceIds,
    count,
    types,
    ...(themeFilter && themeFilter.trim().length > 0
      ? { themeFilter: themeFilter.trim() }
      : {}),
    ...(title ? { title } : {}),
  };
}
