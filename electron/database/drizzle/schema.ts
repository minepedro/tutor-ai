import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/*
  Schema declarado em TypeScript (v0.7.3+).

  Espelha exatamente o `schema.sql` original. Drizzle infere tipos das queries
  a partir destas declarações — não há mais necessidade de definir Row types
  manualmente em cada repository.

  💡 IMPORTANTE: Drizzle não suporta CREATE VIRTUAL TABLE (FTS5) declarativa-
  mente. A tabela `document_chunks_fts` e os 3 triggers de sincronização ficam
  como SQL raw em migration manual (ver `electron/database/migrations/`).
  Queries `MATCH` em chunks.repo.ts são feitas com `db.run(sql\`...\`)`.

  💡 Datas: SQLite armazena `DATETIME` como TEXT (ISO 8601) com
  `CURRENT_TIMESTAMP` como default. Drizzle usa `text('col').default(sql\`CURRENT_TIMESTAMP\`)`.

  💡 Booleans: SQLite não tem boolean nativo — usa INTEGER 0/1. Mantemos como
  `integer()` simples; conversão fica no mapper (já existente nos repos).

  💡 JSON columns: armazenadas como TEXT, parsed/stringified em JS. Drizzle
  oferece `.$type<T>()` pra tipar mas continuamos com transformação manual nos
  repos (sem regressão).
*/

// ── Hierarquia de conteúdo ───────────────────────────────────────────────

export const subjects = sqliteTable('subjects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#7c5cfc'),
  emoji: text('emoji').default('📚'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(),
  subjectId: text('subject_id')
    .notNull()
    .references((): AnySQLiteColumn => subjects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references((): AnySQLiteColumn => topics.id, { onDelete: 'cascade' }),
  filename: text('filename'),
  fileType: text('file_type'), // pdf | txt | url | paste
  contentHash: text('content_hash'),
  extractedConcepts: text('extracted_concepts'), // JSON
  rawText: text('raw_text'),
  filePath: text('file_path'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Chunks (texto pra RAG) ───────────────────────────────────────────────
// FTS5 virtual table NÃO declarada aqui (limitação do Drizzle). Vive em
// migration manual.

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey(),
  sourceId: text('source_id')
    .notNull()
    .references((): AnySQLiteColumn => sources.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index'),
  content: text('content').notNull(),
  pageNumber: integer('page_number'),
  tokenCount: integer('token_count'),
  /** Label estrutural detectado (ex: "exercício 5"). v0.5.0+. */
  structuralLabel: text('structural_label'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Quizzes ──────────────────────────────────────────────────────────────

export const quizzes = sqliteTable('quizzes', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references((): AnySQLiteColumn => topics.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(
    (): AnySQLiteColumn => sources.id,
    { onDelete: 'set null' },
  ),
  title: text('title'),
  quizMode: text('quiz_mode', { enum: ['quick', 'quality'] }).default('quality'),
  totalQuestions: integer('total_questions'),
  score: integer('score'),
  timeSpentSeconds: integer('time_spent_seconds'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const quizQuestions = sqliteTable('quiz_questions', {
  id: text('id').primaryKey(),
  quizId: text('quiz_id')
    .notNull()
    .references((): AnySQLiteColumn => quizzes.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['multiple_choice', 'true_false'] }).notNull(),
  difficulty: text('difficulty', { enum: ['easy', 'medium', 'hard'] }).default('medium'),
  question: text('question').notNull(),
  options: text('options').notNull(), // JSON array
  correctIndex: integer('correct_index').notNull(),
  selectedIndex: integer('selected_index'),
  /** SQLite usa 0/1; converte pra boolean no mapper. */
  isCorrect: integer('is_correct'),
  explanation: text('explanation'),
  /** Schema legacy (v0.1) — não populado desde v0.7 (chat reusa conversations). */
  doubtQuestion: text('doubt_question'),
  doubtResponse: text('doubt_response'),
  answeredAt: text('answered_at'),
});

// ── Flashcards (schema reservado, sem feature ainda) ──────────────────────

export const flashcards = sqliteTable('flashcards', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references((): AnySQLiteColumn => topics.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(
    (): AnySQLiteColumn => sources.id,
    { onDelete: 'set null' },
  ),
  front: text('front').notNull(),
  back: text('back').notNull(),
  tags: text('tags'), // JSON array
  easeFactor: real('ease_factor').default(2.5),
  intervalDays: integer('interval_days').default(0),
  repetitions: integer('repetitions').default(0),
  nextReviewAt: text('next_review_at'),
  lastReviewedAt: text('last_reviewed_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const flashcardReviews = sqliteTable('flashcard_reviews', {
  id: text('id').primaryKey(),
  flashcardId: text('flashcard_id')
    .notNull()
    .references((): AnySQLiteColumn => flashcards.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(), // 1=errou 2=difícil 3=ok 4=fácil
  reviewedAt: text('reviewed_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Exercícios (schema reservado, sem feature ainda) ──────────────────────

export const exercises = sqliteTable('exercises', {
  id: text('id').primaryKey(),
  topicId: text('topic_id')
    .notNull()
    .references((): AnySQLiteColumn => topics.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').references(
    (): AnySQLiteColumn => sources.id,
    { onDelete: 'set null' },
  ),
  problemText: text('problem_text').notNull(),
  solutionSteps: text('solution_steps'), // JSON
  userAnswer: text('user_answer'),
  aiFeedback: text('ai_feedback'),
  isCorrect: integer('is_correct'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Chat ─────────────────────────────────────────────────────────────────

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  /** scope_type: inline | document | topic | subject | quiz_question */
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references((): AnySQLiteColumn => conversations.id, { onDelete: 'cascade' }),
  /** role: user | assistant */
  role: text('role').notNull(),
  content: text('content').notNull(),
  /** JSON: lista de chunk_ids usados como contexto (só assistants). */
  contextChunks: text('context_chunks'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ── Configurações ────────────────────────────────────────────────────────

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
