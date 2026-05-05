import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql, count } from 'drizzle-orm';
import { getDrizzleDb } from '../connection';
import { quizzes, quizQuestions } from '../drizzle/schema';

/*
  Persistência de quizzes + quiz_questions. Diferente de subjects/topics/sources,
  aqui temos 2 tabelas relacionadas (quiz tem N quiz_questions). Mantém num
  arquivo só porque sempre operam juntas — criar quiz "vazio" sem perguntas
  não faz sentido.

  v0.7.3: migrado pra Drizzle. Transações via `db.transaction(tx => ...)`.
*/

export type QuestionType = 'multiple_choice' | 'true_false';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuizMode = 'quick' | 'quality';

export interface QuizQuestion {
  id: string;
  quizId: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  question: string;
  /** Array de strings (parsed do JSON do banco). */
  options: string[];
  correctIndex: number;
  /** Resposta do usuário (null = ainda não respondeu). */
  selectedIndex: number | null;
  /** True/false após responder; null se ainda não respondeu. */
  isCorrect: boolean | null;
  explanation: string;
  /** Schema legacy v0.1 — não populado desde v0.7. */
  doubtQuestion: string | null;
  doubtResponse: string | null;
  answeredAt: string | null;
}

export interface Quiz {
  id: string;
  topicId: string;
  sourceId: string | null;
  title: string | null;
  quizMode: QuizMode;
  totalQuestions: number;
  score: number | null;
  timeSpentSeconds: number | null;
  completedAt: string | null;
  createdAt: string;
  questions: QuizQuestion[];
}

export interface CreateQuizInput {
  topicId: string;
  sourceId: string | null;
  title?: string | null;
  quizMode: QuizMode;
  questions: Array<{
    type: QuestionType;
    difficulty: QuestionDifficulty;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
}

function normalizeQuestion(row: typeof quizQuestions.$inferSelect): QuizQuestion {
  return {
    id: row.id,
    quizId: row.quizId,
    type: row.type as QuestionType,
    difficulty: (row.difficulty ?? 'medium') as QuestionDifficulty,
    question: row.question,
    options: JSON.parse(row.options) as string[],
    correctIndex: row.correctIndex,
    selectedIndex: row.selectedIndex,
    isCorrect: row.isCorrect === null ? null : row.isCorrect === 1,
    explanation: row.explanation ?? '',
    doubtQuestion: row.doubtQuestion,
    doubtResponse: row.doubtResponse,
    answeredAt: row.answeredAt,
  };
}

function normalizeQuiz(
  row: typeof quizzes.$inferSelect,
  questions: QuizQuestion[],
): Quiz {
  return {
    id: row.id,
    topicId: row.topicId,
    sourceId: row.sourceId,
    title: row.title,
    quizMode: (row.quizMode ?? 'quality') as QuizMode,
    totalQuestions: row.totalQuestions ?? 0,
    score: row.score,
    timeSpentSeconds: row.timeSpentSeconds,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    questions,
  };
}

/**
 * Cria quiz + perguntas atomicamente. Retorna o quiz montado.
 *
 * 💡 Transação envolve as duas inserções (quiz + N quiz_questions). Se algo
 * falhar no meio, faz rollback — não fica quiz órfão sem perguntas.
 */
export function createQuiz(input: CreateQuizInput): Quiz {
  if (input.questions.length === 0) {
    throw new Error('Quiz precisa de pelo menos 1 pergunta');
  }

  const db = getDrizzleDb();
  const quizId = randomUUID();

  db.transaction((tx) => {
    tx.insert(quizzes)
      .values({
        id: quizId,
        topicId: input.topicId,
        sourceId: input.sourceId,
        title: input.title ?? null,
        quizMode: input.quizMode,
        totalQuestions: input.questions.length,
      })
      .run();

    for (const q of input.questions) {
      tx.insert(quizQuestions)
        .values({
          id: randomUUID(),
          quizId,
          type: q.type,
          difficulty: q.difficulty,
          question: q.question,
          options: JSON.stringify(q.options),
          correctIndex: q.correctIndex,
          explanation: q.explanation,
        })
        .run();
    }
  });

  const quiz = getQuiz(quizId);
  if (!quiz) throw new Error('Falha ao recuperar quiz recém-criado');
  return quiz;
}

/**
 * Busca quiz pelo ID com todas as perguntas. Retorna null se não existir.
 */
export function getQuiz(id: string): Quiz | null {
  const db = getDrizzleDb();

  const quizRow = db.select().from(quizzes).where(eq(quizzes.id, id)).get();
  if (!quizRow) return null;

  const questions = db
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, id))
    .orderBy(asc(sql`rowid`))
    .all()
    .map(normalizeQuestion);

  return normalizeQuiz(quizRow, questions);
}

/**
 * Busca uma pergunta de quiz isolada (sem o resto do quiz). Útil pra contextos
 * onde só a pergunta + alternativas + explicação importam — ex: chat inline
 * em pergunta de quiz (v0.7.0).
 */
export function getQuizQuestion(id: string): QuizQuestion | null {
  const db = getDrizzleDb();
  const row = db.select().from(quizQuestions).where(eq(quizQuestions.id, id)).get();
  return row ? normalizeQuestion(row) : null;
}

export interface QuizSummary {
  id: string;
  topicId: string;
  sourceId: string | null;
  title: string | null;
  totalQuestions: number;
  score: number | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Lista quizzes de um tópico (sem as perguntas, pra listagem rápida).
 */
export function listQuizzesByTopic(topicId: string): QuizSummary[] {
  const db = getDrizzleDb();
  const rows = db
    .select()
    .from(quizzes)
    .where(eq(quizzes.topicId, topicId))
    .orderBy(desc(quizzes.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.id,
    topicId: r.topicId,
    sourceId: r.sourceId,
    title: r.title,
    totalQuestions: r.totalQuestions ?? 0,
    score: r.score,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Registra resposta do usuário a uma pergunta. Marca isCorrect e answeredAt.
 */
export function answerQuestion(
  questionId: string,
  selectedIndex: number,
): QuizQuestion {
  const db = getDrizzleDb();

  const current = db
    .select({ correctIndex: quizQuestions.correctIndex })
    .from(quizQuestions)
    .where(eq(quizQuestions.id, questionId))
    .get();

  if (!current) throw new Error(`Pergunta ${questionId} não encontrada`);

  const isCorrect = selectedIndex === current.correctIndex ? 1 : 0;

  db.update(quizQuestions)
    .set({
      selectedIndex,
      isCorrect,
      answeredAt: sql`CURRENT_TIMESTAMP` as unknown as string,
    })
    .where(eq(quizQuestions.id, questionId))
    .run();

  const row = db.select().from(quizQuestions).where(eq(quizQuestions.id, questionId)).get();
  if (!row) throw new Error('Falha ao recuperar pergunta atualizada');
  return normalizeQuestion(row);
}

/**
 * Finaliza o quiz: calcula score, marca completedAt, salva tempo gasto.
 */
export function finishQuiz(quizId: string, timeSpentSeconds: number): Quiz {
  const db = getDrizzleDb();

  const correctCount = db
    .select({ count: count() })
    .from(quizQuestions)
    .where(
      and(
        eq(quizQuestions.quizId, quizId),
        eq(quizQuestions.isCorrect, 1),
      ),
    )
    .get();

  const total = db
    .select({ total: quizzes.totalQuestions })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .get();

  if (!total) throw new Error(`Quiz ${quizId} não encontrado`);

  const score = correctCount?.count ?? 0;

  db.update(quizzes)
    .set({
      score,
      timeSpentSeconds,
      completedAt: sql`CURRENT_TIMESTAMP` as unknown as string,
    })
    .where(eq(quizzes.id, quizId))
    .run();

  const quiz = getQuiz(quizId);
  if (!quiz) throw new Error('Falha ao recuperar quiz finalizado');
  return quiz;
}

export function deleteQuiz(id: string): void {
  const db = getDrizzleDb();
  const result = db.delete(quizzes).where(eq(quizzes.id, id)).run();
  if (result.changes === 0) throw new Error(`Quiz ${id} não encontrado`);
}

export function renameQuiz(id: string, title: string): Quiz {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('Título não pode ficar vazio');
  }
  const db = getDrizzleDb();
  const result = db
    .update(quizzes)
    .set({ title: trimmed })
    .where(eq(quizzes.id, id))
    .run();
  if (result.changes === 0) throw new Error(`Quiz ${id} não encontrado`);

  const quiz = getQuiz(id);
  if (!quiz) throw new Error('Falha ao recuperar quiz após rename');
  return quiz;
}

/**
 * "Refazer" um quiz: limpa selected_index/is_correct/answered_at de todas as
 * perguntas e zera score/time_spent/completed_at do quiz. Mantém as perguntas
 * geradas — usuário responde as MESMAS de novo. Zero tokens, zero custo de API.
 */
export function resetQuiz(quizId: string): Quiz {
  const db = getDrizzleDb();

  const existing = db
    .select({ id: quizzes.id })
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .get();
  if (!existing) throw new Error(`Quiz ${quizId} não encontrado`);

  db.transaction((tx) => {
    tx.update(quizQuestions)
      .set({
        selectedIndex: null,
        isCorrect: null,
        answeredAt: null,
        doubtQuestion: null,
        doubtResponse: null,
      })
      .where(eq(quizQuestions.quizId, quizId))
      .run();
    tx.update(quizzes)
      .set({
        score: null,
        timeSpentSeconds: null,
        completedAt: null,
      })
      .where(eq(quizzes.id, quizId))
      .run();
  });

  const reset = getQuiz(quizId);
  if (!reset) throw new Error('Falha ao recuperar quiz após reset');
  return reset;
}
