-- =============================================
-- MATÉRIAS E TÓPICOS
-- =============================================

CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#7c5cfc',
    emoji TEXT DEFAULT '📚',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- =============================================
-- MATERIAIS FONTE
-- =============================================

CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    filename TEXT,
    file_type TEXT,                  -- pdf | txt | url | paste
    content_hash TEXT,               -- evita duplicatas
    extracted_concepts TEXT,         -- JSON da análise da IA
    raw_text TEXT,                   -- texto extraído
    file_path TEXT,                  -- caminho do arquivo salvo localmente
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

-- =============================================
-- CHUNKS PARA RAG
-- =============================================

CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    chunk_index INTEGER,
    content TEXT NOT NULL,
    page_number INTEGER,
    token_count INTEGER,
    -- Label estrutural detectado (ex: "exercício 5", "capítulo 3"). v0.5.0+.
    structural_label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

-- =============================================
-- FTS5: índice de full-text search no content (v0.6.0+)
-- External content table — não duplica dados, só mantém índice invertido.
-- tokenizer remove_diacritics 1 → "produção" acha "produção" e "producao".
-- =============================================
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
    content,
    content=document_chunks,
    content_rowid=rowid,
    tokenize='unicode61 remove_diacritics 1'
);

-- Triggers sincronizam FTS automaticamente em insert/delete/update.
CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    INSERT INTO document_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- =============================================
-- QUIZZES
-- =============================================

CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    title TEXT,
    quiz_mode TEXT DEFAULT 'quality', -- quick | quality
    total_questions INTEGER,
    score INTEGER,
    time_spent_seconds INTEGER,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    type TEXT NOT NULL,              -- multiple_choice | true_false
    difficulty TEXT DEFAULT 'medium', -- easy | medium | hard
    question TEXT NOT NULL,
    options TEXT NOT NULL,           -- JSON array de alternativas
    correct_index INTEGER NOT NULL,
    selected_index INTEGER,
    is_correct INTEGER,              -- SQLite usa 0/1 para boolean
    explanation TEXT,
    doubt_question TEXT,
    doubt_response TEXT,
    answered_at DATETIME,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

-- =============================================
-- FLASHCARDS
-- =============================================

CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    tags TEXT,                       -- JSON array
    ease_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_review_at DATETIME,
    last_reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flashcard_reviews (
    id TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL,
    rating INTEGER NOT NULL,         -- 1=errou 2=difícil 3=ok 4=fácil
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
);

-- =============================================
-- EXERCÍCIOS RESOLVIDOS
-- =============================================

CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    problem_text TEXT NOT NULL,
    solution_steps TEXT,             -- JSON com passo a passo
    user_answer TEXT,
    ai_feedback TEXT,
    is_correct INTEGER,              -- SQLite usa 0/1 para boolean
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

-- =============================================
-- CHAT / CONVERSAS
-- =============================================

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    scope_type TEXT NOT NULL,        -- inline | document | topic | subject
    scope_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,              -- user | assistant
    content TEXT NOT NULL,
    context_chunks TEXT,             -- JSON: chunks usados na resposta
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- =============================================
-- CONFIGURAÇÕES
-- =============================================

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
