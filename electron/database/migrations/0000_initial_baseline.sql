CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`chunk_index` integer,
	`content` text NOT NULL,
	`page_number` integer,
	`token_count` integer,
	`structural_label` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`source_id` text,
	`problem_text` text NOT NULL,
	`solution_steps` text,
	`user_answer` text,
	`ai_feedback` text,
	`is_correct` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `flashcard_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`flashcard_id` text NOT NULL,
	`rating` integer NOT NULL,
	`reviewed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`flashcard_id`) REFERENCES `flashcards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `flashcards` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`source_id` text,
	`front` text NOT NULL,
	`back` text NOT NULL,
	`tags` text,
	`ease_factor` real DEFAULT 2.5,
	`interval_days` integer DEFAULT 0,
	`repetitions` integer DEFAULT 0,
	`next_review_at` text,
	`last_reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`context_chunks` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`type` text NOT NULL,
	`difficulty` text DEFAULT 'medium',
	`question` text NOT NULL,
	`options` text NOT NULL,
	`correct_index` integer NOT NULL,
	`selected_index` integer,
	`is_correct` integer,
	`explanation` text,
	`doubt_question` text,
	`doubt_response` text,
	`answered_at` text,
	FOREIGN KEY (`quiz_id`) REFERENCES `quizzes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quizzes` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`source_id` text,
	`title` text,
	`quiz_mode` text DEFAULT 'quality',
	`total_questions` integer,
	`score` integer,
	`time_spent_seconds` integer,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`topic_id` text NOT NULL,
	`filename` text,
	`file_type` text,
	`content_hash` text,
	`extracted_concepts` text,
	`raw_text` text,
	`file_path` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#7c5cfc',
	`emoji` text DEFAULT '📚',
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`subject_id`) REFERENCES `subjects`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
-- ============================================================
-- FTS5: índice de full-text search no document_chunks (v0.6.0+)
-- Drizzle não modela CREATE VIRTUAL TABLE — adicionado manualmente.
-- External content table — não duplica dados, só mantém índice invertido.
-- tokenizer remove_diacritics 1 → "produção" acha "produção" e "producao".
-- ============================================================
CREATE VIRTUAL TABLE `document_chunks_fts` USING fts5(
	content,
	content=document_chunks,
	content_rowid=rowid,
	tokenize='unicode61 remove_diacritics 1'
);
--> statement-breakpoint
-- Triggers sincronizam FTS automaticamente em insert/delete/update.
CREATE TRIGGER `document_chunks_ai` AFTER INSERT ON `document_chunks` BEGIN
	INSERT INTO document_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `document_chunks_ad` AFTER DELETE ON `document_chunks` BEGIN
	INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `document_chunks_au` AFTER UPDATE ON `document_chunks` BEGIN
	INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
	INSERT INTO document_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
