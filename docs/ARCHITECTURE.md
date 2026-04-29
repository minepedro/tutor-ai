# tutor.ai — Arquitetura Completa

## Visão Geral

**tutor.ai** é um aplicativo desktop open source de estudo personalizado com IA. O usuário sobe seu material de estudo (PDFs, textos, anotações), e a IA gera quizzes, flashcards, resolve exercícios e tira dúvidas — tudo rodando localmente com os dados salvos no computador do usuário.

O app é distribuído como executável via Electron. A única dependência externa é uma API key da Anthropic (Claude), que o próprio usuário fornece.

---

## Stack Tecnológica

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Desktop | Electron 33+ | Maduro, grande ecossistema, multiplataforma |
| Frontend | React 19 + Vite 6 + TypeScript | Produtivo, tipado, ecossistema extenso |
| Estilização | Tailwind CSS 4 | Dark theme nativo, utility-first, responsivo |
| Roteamento | React Router 7 | Navegação entre páginas do app |
| Banco de dados | better-sqlite3 | Síncrono, rápido, sem ORM, arquivo único |
| Embeddings | onnxruntime-node + all-MiniLM-L6-v2 | Busca semântica local, offline, gratuito |
| Busca vetorial | LanceDB | Embedded, Node.js nativo, sem servidor |
| IA | API Anthropic (Claude Sonnet) | Geração de quiz, chat, resolução de exercícios |
| Segurança | Electron safeStorage | API key encriptada pelo SO |
| Build | electron-builder | Gera executáveis Win/Mac/Linux |

---

## Estrutura do Projeto

```
tutor-ai/
│
├── electron/                              # MAIN PROCESS (Node.js)
│   ├── main.ts                            # Entry point, cria janela
│   ├── preload.ts                         # contextBridge (segurança)
│   │
│   ├── ipc/                               # IPC handlers (backend)
│   │   ├── claude.ipc.ts                  # Proxy seguro para API
│   │   ├── database.ipc.ts                # CRUD no SQLite
│   │   ├── files.ipc.ts                   # Upload, leitura de arquivos
│   │   ├── embeddings.ipc.ts              # Gerar/buscar embeddings
│   │   └── settings.ipc.ts                # API key, preferências
│   │
│   ├── services/                          # Lógica de negócio
│   │   ├── claude.service.ts              # Chamadas à API do Claude
│   │   ├── embedding.service.ts           # ONNX model loading + embed
│   │   ├── rag.service.ts                 # Chunking + busca + contexto
│   │   ├── quiz-generator.service.ts      # Pipeline de geração de quiz
│   │   └── spaced-repetition.service.ts   # Algoritmo FSRS
│   │
│   ├── database/
│   │   ├── connection.ts                  # Inicializa SQLite
│   │   ├── schema.sql                     # Criação das tabelas
│   │   ├── migrations/                    # Alterações futuras
│   │   └── repositories/                  # Queries organizadas por entidade
│   │       ├── subjects.repo.ts
│   │       ├── topics.repo.ts
│   │       ├── quizzes.repo.ts
│   │       ├── flashcards.repo.ts
│   │       ├── exercises.repo.ts
│   │       ├── conversations.repo.ts
│   │       └── chunks.repo.ts
│   │
│   └── utils/
│       ├── pdf-parser.ts                  # Extração de texto de PDF
│       ├── text-chunker.ts                # Divide texto em chunks ~500 tokens
│       └── crypto.ts                      # safeStorage helpers
│
├── src/                                   # RENDERER (React app)
│   ├── App.tsx                            # Router principal
│   │
│   ├── components/
│   │   ├── ui/                            # Design system reutilizável
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Badge.tsx
│   │   │   ├── Progress.tsx
│   │   │   ├── Dropdown.tsx
│   │   │   └── Sidebar.tsx
│   │   │
│   │   ├── quiz/
│   │   │   ├── QuizCard.tsx               # Pergunta + opções
│   │   │   ├── QuizOption.tsx             # Botão de alternativa
│   │   │   ├── QuizExplanation.tsx        # Explicação pós-resposta
│   │   │   ├── QuizProgress.tsx           # Barra de progresso
│   │   │   └── QuizResults.tsx            # Tela de resultado
│   │   │
│   │   ├── flashcard/
│   │   │   ├── FlashcardViewer.tsx        # Card com flip (frente/verso)
│   │   │   ├── FlashcardRating.tsx        # Botões: errei/difícil/ok/fácil
│   │   │   └── FlashcardDeck.tsx          # Sessão de estudo
│   │   │
│   │   ├── exercise/
│   │   │   ├── ExerciseViewer.tsx         # Enunciado + resolução
│   │   │   └── ExerciseSteps.tsx          # Passo a passo da resolução
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx              # Painel lateral (drawer)
│   │   │   ├── ChatMessage.tsx            # Mensagem individual
│   │   │   └── ChatInput.tsx              # Input + botão enviar
│   │   │
│   │   └── layout/
│   │       ├── AppLayout.tsx              # Sidebar + área de conteúdo
│   │       ├── Header.tsx                 # Topo do app
│   │       └── SubjectCard.tsx            # Card de matéria no dashboard
│   │
│   ├── pages/
│   │   ├── Onboarding.tsx                 # Primeiro acesso: API key
│   │   ├── Home.tsx                       # Dashboard com matérias
│   │   ├── SubjectView.tsx                # Tópicos de uma matéria
│   │   ├── QuizSetup.tsx                  # Upload + config do quiz
│   │   ├── QuizPlay.tsx                   # Jogar o quiz
│   │   ├── QuizReview.tsx                 # Revisar respostas após quiz
│   │   ├── FlashcardStudy.tsx             # Sessão de flashcards
│   │   ├── ExerciseSolver.tsx             # Tutor de exercícios
│   │   ├── Library.tsx                    # Todos os materiais salvos
│   │   └── Settings.tsx                   # API key, preferências, limpar dados
│   │
│   ├── hooks/
│   │   ├── useIPC.ts                      # Wrapper tipado para IPC calls
│   │   ├── useQuiz.ts                     # Estado e lógica do quiz
│   │   ├── useFlashcards.ts               # Estado dos flashcards
│   │   ├── useChat.ts                     # Estado do chat
│   │   ├── useSubjects.ts                 # CRUD matérias/tópicos
│   │   └── useTheme.ts                    # Dark/light theme (futuro)
│   │
│   ├── lib/
│   │   ├── prompts/                       # Templates de prompt para a IA
│   │   │   ├── quiz-analysis.ts           # Etapa 1: extrai conceitos do material
│   │   │   ├── quiz-generation.ts         # Etapa 2: gera perguntas
│   │   │   ├── quiz-validation.ts         # Etapa 3: valida qualidade
│   │   │   ├── flashcard-generation.ts    # Gera flashcards do material
│   │   │   ├── exercise-solver.ts         # Resolve exercício passo a passo
│   │   │   └── chat-tutor.ts              # System prompt do chat tutor
│   │   │
│   │   ├── constants.ts                   # Cores, configs, limites
│   │   └── utils.ts                       # Helpers genéricos
│   │
│   ├── types/                             # Tipos TypeScript compartilhados
│   │   ├── quiz.ts
│   │   ├── flashcard.ts
│   │   ├── exercise.ts
│   │   ├── chat.ts
│   │   ├── subject.ts
│   │   └── ipc.ts                         # Contratos main↔renderer
│   │
│   └── styles/
│       └── globals.css                    # Tailwind base + variáveis dark theme
│
├── models/                                # Modelo ONNX (gitignored, baixado no setup)
│   └── .gitkeep
│
├── scripts/
│   ├── setup-models.ts                    # Baixa modelo ONNX (~30MB)
│   └── reset-db.ts                        # Limpa banco de dados
│
├── docs/
│   ├── ARCHITECTURE.md                    # Este arquivo
│   ├── TODO.md                            # Roadmap e versionamento
│   └── CONTRIBUTING.md                    # Guia para contribuidores
│
├── .env.example                           # ANTHROPIC_API_KEY=sua-chave-aqui
├── .gitignore
├── package.json                           # Dependências e scripts
├── tsconfig.json                          # TypeScript config (renderer)
├── tsconfig.node.json                     # TypeScript config (electron)
├── vite.config.ts                         # Vite config
├── tailwind.config.ts                     # Tailwind config
├── electron-builder.yml                   # Config para gerar executáveis
├── LICENSE                                # MIT
└── README.md                              # Documentação principal
```

---

## Schema do Banco de Dados (SQLite)

```sql
-- =============================================
-- MATÉRIAS E TÓPICOS
-- =============================================

CREATE TABLE subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#7c5cfc',
    emoji TEXT DEFAULT '📚',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE topics (
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

CREATE TABLE sources (
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

CREATE TABLE document_chunks (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    chunk_index INTEGER,
    content TEXT NOT NULL,
    page_number INTEGER,
    token_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);
-- Nota: os embeddings (vetores) são salvos no LanceDB, não no SQLite.
-- O campo `id` do chunk é usado como chave de ligação entre SQLite e LanceDB.

-- =============================================
-- QUIZZES
-- =============================================

CREATE TABLE quizzes (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    title TEXT,
    quiz_mode TEXT DEFAULT 'quality', -- quick (1 chamada) | quality (3 chamadas)
    total_questions INTEGER,
    score INTEGER,
    time_spent_seconds INTEGER,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE quiz_questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    type TEXT NOT NULL,              -- multiple_choice | true_false
    difficulty TEXT DEFAULT 'medium', -- easy | medium | hard
    question TEXT NOT NULL,
    options TEXT NOT NULL,           -- JSON array de alternativas
    correct_index INTEGER NOT NULL,
    selected_index INTEGER,         -- o que o usuário respondeu
    is_correct BOOLEAN,
    explanation TEXT,
    doubt_question TEXT,             -- dúvida do usuário (se perguntou)
    doubt_response TEXT,             -- resposta da IA
    answered_at DATETIME,
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
);

-- =============================================
-- FLASHCARDS
-- =============================================

CREATE TABLE flashcards (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    tags TEXT,                       -- JSON array
    -- Spaced repetition (FSRS)
    ease_factor REAL DEFAULT 2.5,
    interval_days INTEGER DEFAULT 0,
    repetitions INTEGER DEFAULT 0,
    next_review_at DATETIME,
    last_reviewed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE flashcard_reviews (
    id TEXT PRIMARY KEY,
    flashcard_id TEXT NOT NULL,
    rating INTEGER NOT NULL,         -- 1=errou 2=difícil 3=ok 4=fácil
    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (flashcard_id) REFERENCES flashcards(id) ON DELETE CASCADE
);

-- =============================================
-- EXERCÍCIOS RESOLVIDOS
-- =============================================

CREATE TABLE exercises (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    source_id TEXT,
    problem_text TEXT NOT NULL,
    solution_steps TEXT,             -- JSON com passo a passo
    user_answer TEXT,
    ai_feedback TEXT,
    is_correct BOOLEAN,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

-- =============================================
-- CHAT / CONVERSAS
-- =============================================

CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    scope_type TEXT NOT NULL,         -- inline | document | topic | subject
    scope_id TEXT NOT NULL,           -- id do quiz/flashcard/source/topic/subject
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,                -- user | assistant
    content TEXT NOT NULL,
    context_chunks TEXT,              -- JSON: quais chunks foram usados na resposta
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- =============================================
-- CONFIGURAÇÕES
-- =============================================

CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

---

## Pipeline de Geração de Quiz (3 Etapas)

### Problema
Enviar o PDF direto com "gere um quiz" produz perguntas genéricas, superficiais, ou sobre o documento em si (metadados) em vez do conteúdo acadêmico.

### Solução: Pipeline em 3 etapas

**Etapa 1 — Análise (quiz-analysis.ts)**
- Input: texto extraído do material
- Output: lista estruturada de conceitos, definições, fórmulas e relações
- Objetivo: a IA primeiro entende o conteúdo antes de criar perguntas
- Regra: ignorar headers, footers, numeração de página, metadados do documento

**Etapa 2 — Geração (quiz-generation.ts)**
- Input: lista de conceitos da etapa 1
- Output: N perguntas (múltipla escolha + verdadeiro/falso)
- Regras:
  - Testar compreensão, não memorização
  - Alternativas devem ser plausíveis (não obviamente erradas)
  - Nunca fazer perguntas sobre o documento em si
  - Cada pergunta deve ter explicação detalhada da resposta correta
  - Misturar dificuldades (easy, medium, hard)

**Etapa 3 — Validação (quiz-validation.ts)**
- Input: perguntas geradas na etapa 2
- Output: perguntas validadas e filtradas
- Regras: remover perguntas ambíguas, com mais de uma resposta correta, ou triviais

### Modo rápido vs qualidade
- **quick**: 1 chamada (etapas 1+2 combinadas, sem validação). Mais barato, mais rápido.
- **quality**: 3 chamadas separadas. Melhor qualidade. Padrão recomendado.

---

## Sistema de Chat (RAG)

### Tipos de chat por escopo

| Escopo | Quando ativa | O que vai no contexto | Tokens estimados |
|---|---|---|---|
| inline | Dúvida no quiz/flashcard/exercício | Pergunta + explicação + trecho do material | ~2-3k |
| document | Chat sobre um documento específico | Top 5 chunks via RAG + histórico | ~5-8k |
| topic | Chat sobre um tópico | Top 5 chunks de todos os docs do tópico | ~5-8k |
| subject | Chat sobre uma matéria inteira | Top 5 chunks de todos os docs da matéria | ~5-8k |

### Fluxo do RAG

```
Upload do PDF
    → Extrai texto (página por página)
    → Divide em chunks de ~500 tokens
    → ONNX (all-MiniLM-L6-v2) gera embedding de cada chunk
    → LanceDB salva os vetores
    → SQLite salva os metadados do chunk

Pergunta do usuário no chat
    → ONNX gera embedding da pergunta
    → LanceDB busca os 5 chunks mais similares
    → SQLite pega metadados adicionais (matéria, tópico, página)
    → Monta contexto: system prompt + chunks + histórico resumido
    → Claude responde baseado no material do aluno
```

### Gerenciamento de contexto
- Sliding window: mantém últimas 10 mensagens do chat
- Mensagens mais antigas são resumidas automaticamente em um parágrafo
- System prompt instrui a IA a responder APENAS com base nos trechos fornecidos
- Cada resposta cita a fonte ("De acordo com o slide 14...")

---

## Armazenamento Local

Tudo fica salvo na pasta de dados do app:
- **Windows:** `C:\Users\{user}\AppData\Roaming\tutor-ai\`
- **Mac:** `~/Library/Application Support/tutor-ai/`
- **Linux:** `~/.config/tutor-ai/`

Acessado via `app.getPath('userData')` do Electron.

```
tutor-ai/                        (userData)
├── database.db                  ← SQLite: tudo do app
├── embeddings/                  ← LanceDB: vetores para busca
├── sources/                     ← PDFs e arquivos originais
│   ├── a1b2c3d4.pdf             ← renomeados com hash único
│   └── e5f6g7h8.txt
└── models/                      ← Modelo ONNX
    └── all-MiniLM-L6-v2.onnx
```

- **API key**: salva via Electron safeStorage (encriptada pelo SO)
- **Backup**: copiar a pasta inteira restaura tudo
- **Reset**: deletar a pasta e o app recria do zero

---

## Segurança

- API key encriptada via safeStorage do Electron (Keychain/Credential Manager/libsecret)
- Frontend (renderer) nunca acessa Node.js, banco, ou API key diretamente
- Toda comunicação via IPC com contratos tipados pelo preload.ts (contextBridge)
- Prepared statements no SQLite (sem SQL injection)
- Nenhum dado sai da máquina exceto chamadas à API do Claude
- Content Security Policy no Electron bloqueia scripts externos
- Entrada do usuário sanitizada antes de salvar no banco

---

## Dependências (package.json)

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "better-sqlite3": "^11.0.0",
    "onnxruntime-node": "^1.19.0",
    "vectordb": "^0.5.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.6.0",
    "tailwindcss": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/better-sqlite3": "^7.0.0"
  }
}
```

---

## Fluxo do Usuário

```
Primeiro acesso
    → Tela de onboarding: cola API key → salva encriptada
    → App baixa modelo ONNX (~30MB) com progress bar
    → Pronto para usar

Uso normal
    → Home: vê matérias com stats
    → Cria matéria + tópico (ou seleciona existente)
    → Sobe PDF / cola texto
    → Escolhe: Gerar Quiz | Gerar Flashcards | Resolver Exercício
    → Estuda com feedback da IA
    → Chat lateral para tirar dúvidas a qualquer momento
    → Histórico salvo automaticamente
```

---

## Design

- **Tema**: Dark theme padrão (cores roxo/violet como accent)
- **Fontes**: JetBrains Mono (código/labels) + Outfit (texto)
- **Framework CSS**: Tailwind CSS 4
- **Responsividade**: Adaptado para diferentes tamanhos de janela Electron
- **Animações**: Transições suaves, progress bars, flip de flashcard

---

## .gitignore

```
node_modules/
dist/
release/
.env
models/*.onnx
*.db
embeddings/
```
