import { randomUUID } from 'node:crypto';
import { getDb } from '../connection';

/*
  Persistência de quizzes + quiz_questions. Diferente de subjects/topics/sources,
  aqui temos 2 tabelas relacionadas (quiz tem N quiz_questions). Mantém num
  arquivo só porque sempre operam juntas — criar quiz "vazio" sem perguntas
  não faz sentido.

  Padrão de IDs: cada quiz e cada pergunta ganha UUID separado. Quiz "armazena"
  o resultado completo (score, tempo, gabarito vs respostas).
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
  /** Pergunta do usuário (chat inline futuro). Null por enquanto. */
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
  /** Perguntas — sempre carregadas junto com o quiz. */
  questions: QuizQuestion[];
}

/**
 * Input pra criar quiz: vem do quiz-generator com perguntas já validadas.
 * O `selectedIndex`, `isCorrect`, `score` etc começam null/undefined.
 */
export interface CreateQuizInput {
  topicId: string;
  /** Pode ser null se quiz veio de múltiplas sources. */
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

interface QuizRow {
  id: string;
  topic_id: string;
  source_id: string | null;
  title: string | null;
  quiz_mode: string;
  total_questions: number;
  score: number | null;
  time_spent_seconds: number | null;
  completed_at: string | null;
  created_at: string;
}

interface QuizQuestionRow {
  id: string;
  quiz_id: string;
  type: string;
  difficulty: string;
  question: string;
  options: string;
  correct_index: number;
  selected_index: number | null;
  is_correct: number | null; // SQLite stores boolean as 0/1
  explanation: string | null;
  doubt_question: string | null;
  doubt_response: string | null;
  answered_at: string | null;
}

function mapQuiz(row: QuizRow, questions: QuizQuestion[]): Quiz {
  return {
    id: row.id,
    topicId: row.topic_id,
    sourceId: row.source_id,
    title: row.title,
    quizMode: row.quiz_mode as QuizMode,
    totalQuestions: row.total_questions,
    score: row.score,
    timeSpentSeconds: row.time_spent_seconds,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    questions,
  };
}

function mapQuestion(row: QuizQuestionRow): QuizQuestion {
  return {
    id: row.id,
    quizId: row.quiz_id,
    type: row.type as QuestionType,
    difficulty: row.difficulty as QuestionDifficulty,
    question: row.question,
    options: JSON.parse(row.options) as string[],
    correctIndex: row.correct_index,
    selectedIndex: row.selected_index,
    isCorrect: row.is_correct === null ? null : row.is_correct === 1,
    explanation: row.explanation ?? '',
    doubtQuestion: row.doubt_question,
    doubtResponse: row.doubt_response,
    answeredAt: row.answered_at,
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

  const db = getDb();
  const quizId = randomUUID();

  const insertQuiz = db.prepare(
    `INSERT INTO quizzes (id, topic_id, source_id, title, quiz_mode, total_questions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertQuestion = db.prepare(
    `INSERT INTO quiz_questions
       (id, quiz_id, type, difficulty, question, options, correct_index, explanation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    insertQuiz.run(
      quizId,
      input.topicId,
      input.sourceId,
      input.title ?? null,
      input.quizMode,
      input.questions.length,
    );
    for (const q of input.questions) {
      insertQuestion.run(
        randomUUID(),
        quizId,
        q.type,
        q.difficulty,
        q.question,
        JSON.stringify(q.options),
        q.correctIndex,
        q.explanation,
      );
    }
  });
  tx();

  const quiz = getQuiz(quizId);
  if (!quiz) throw new Error('Falha ao recuperar quiz recém-criado');
  return quiz;
}

/**
 * Busca quiz pelo ID com todas as perguntas. Retorna null se não existir.
 */
export function getQuiz(id: string): Quiz | null {
  const db = getDb();

  const quizRow = db
    .prepare<[string], QuizRow>(
      `SELECT id, topic_id, source_id, title, quiz_mode, total_questions,
              score, time_spent_seconds, completed_at, created_at
       FROM quizzes WHERE id = ?`,
    )
    .get(id);

  if (!quizRow) return null;

  const questions = db
    .prepare<[string], QuizQuestionRow>(
      `SELECT id, quiz_id, type, difficulty, question, options, correct_index,
              selected_index, is_correct, explanation, doubt_question, doubt_response,
              answered_at
       FROM quiz_questions
       WHERE quiz_id = ?
       ORDER BY rowid ASC`,
    )
    .all(id)
    .map(mapQuestion);

  return mapQuiz(quizRow, questions);
}

/**
 * Busca uma pergunta de quiz isolada (sem o resto do quiz). Útil pra contextos
 * onde só a pergunta + alternativas + explicação importam — ex: chat inline
 * em pergunta de quiz (v0.7.0).
 */
export function getQuizQuestion(id: string): QuizQuestion | null {
  const row = getDb()
    .prepare<[string], QuizQuestionRow>(
      `SELECT id, quiz_id, type, difficulty, question, options, correct_index,
              selected_index, is_correct, explanation, doubt_question, doubt_response,
              answered_at
       FROM quiz_questions WHERE id = ?`,
    )
    .get(id);
  return row ? mapQuestion(row) : null;
}

/**
 * Lista quizzes de um tópico (sem as perguntas, pra listagem rápida).
 * Se precisar das perguntas, chama getQuiz(id) na sequência.
 */
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

export function listQuizzesByTopic(topicId: string): QuizSummary[] {
  const db = getDb();
  const rows = db
    .prepare<[string], QuizRow>(
      `SELECT id, topic_id, source_id, title, quiz_mode, total_questions,
              score, time_spent_seconds, completed_at, created_at
       FROM quizzes
       WHERE topic_id = ?
       ORDER BY created_at DESC`,
    )
    .all(topicId);

  return rows.map((r) => ({
    id: r.id,
    topicId: r.topic_id,
    sourceId: r.source_id,
    title: r.title,
    totalQuestions: r.total_questions,
    score: r.score,
    completedAt: r.completed_at,
    createdAt: r.created_at,
  }));
}

/**
 * Registra resposta do usuário a uma pergunta. Marca isCorrect e answeredAt.
 * Não atualiza o score do quiz — chamar `finishQuiz` quando termina.
 */
export function answerQuestion(
  questionId: string,
  selectedIndex: number,
): QuizQuestion {
  const db = getDb();

  const current = db
    .prepare<[string], { correct_index: number }>(
      `SELECT correct_index FROM quiz_questions WHERE id = ?`,
    )
    .get(questionId);

  if (!current) throw new Error(`Pergunta ${questionId} não encontrada`);

  const isCorrect = selectedIndex === current.correct_index ? 1 : 0;

  db.prepare(
    `UPDATE quiz_questions
     SET selected_index = ?, is_correct = ?, answered_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(selectedIndex, isCorrect, questionId);

  const updated = db
    .prepare<[string], QuizQuestionRow>(
      `SELECT id, quiz_id, type, difficulty, question, options, correct_index,
              selected_index, is_correct, explanation, doubt_question, doubt_response,
              answered_at
       FROM quiz_questions WHERE id = ?`,
    )
    .get(questionId);

  if (!updated) throw new Error('Falha ao recuperar pergunta atualizada');
  return mapQuestion(updated);
}

/**
 * Finaliza o quiz: calcula score, marca completedAt, salva tempo gasto.
 * Idempotente — pode ser chamada várias vezes.
 */
export function finishQuiz(quizId: string, timeSpentSeconds: number): Quiz {
  const db = getDb();

  const correctCount = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) as count FROM quiz_questions
       WHERE quiz_id = ? AND is_correct = 1`,
    )
    .get(quizId);

  const total = db
    .prepare<[string], { count: number }>(
      `SELECT total_questions as count FROM quizzes WHERE id = ?`,
    )
    .get(quizId);

  if (!total) throw new Error(`Quiz ${quizId} não encontrado`);

  const score = correctCount?.count ?? 0;

  db.prepare(
    `UPDATE quizzes
     SET score = ?, time_spent_seconds = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(score, timeSpentSeconds, quizId);

  const quiz = getQuiz(quizId);
  if (!quiz) throw new Error('Falha ao recuperar quiz finalizado');
  return quiz;
}

export function deleteQuiz(id: string): void {
  // CASCADE em quiz_questions já cuida das perguntas.
  const result = getDb().prepare(`DELETE FROM quizzes WHERE id = ?`).run(id);
  if (result.changes === 0) throw new Error(`Quiz ${id} não encontrado`);
}

/**
 * Renomeia o título do quiz. Não toca em mais nada.
 */
export function renameQuiz(id: string, title: string): Quiz {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('Título não pode ficar vazio');
  }
  const result = getDb()
    .prepare(`UPDATE quizzes SET title = ? WHERE id = ?`)
    .run(trimmed, id);
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
  const db = getDb();

  const existing = db
    .prepare<[string], { id: string }>(`SELECT id FROM quizzes WHERE id = ?`)
    .get(quizId);
  if (!existing) throw new Error(`Quiz ${quizId} não encontrado`);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE quiz_questions
       SET selected_index = NULL, is_correct = NULL, answered_at = NULL,
           doubt_question = NULL, doubt_response = NULL
       WHERE quiz_id = ?`,
    ).run(quizId);
    db.prepare(
      `UPDATE quizzes
       SET score = NULL, time_spent_seconds = NULL, completed_at = NULL
       WHERE id = ?`,
    ).run(quizId);
  });
  tx();

  const reset = getQuiz(quizId);
  if (!reset) throw new Error('Falha ao recuperar quiz após reset');
  return reset;
}
