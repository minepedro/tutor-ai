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
| Bundler | electron-vite 5 | Unifica main/preload/renderer com HMR |
| Estilização | Tailwind CSS 4 | CSS-first via `@theme` — sem `tailwind.config.ts` nem PostCSS |
| Roteamento | React Router 7 (HashRouter) | Compatível com `file://` em produção do Electron |
| Banco de dados | better-sqlite3 | Síncrono, rápido, sem ORM, arquivo único |
| Embeddings | onnxruntime-node + all-MiniLM-L6-v2 | Busca semântica local, offline, gratuito |
| Busca vetorial | `@lancedb/lancedb` | Embedded, Node.js nativo, sem servidor |
| IA | API Anthropic (Claude Sonnet) | Geração de quiz, chat, resolução de exercícios |
| Segurança | Electron safeStorage | API key encriptada pelo SO |
| Build | electron-builder | Gera executáveis Win/Mac/Linux |

---

## Estrutura do Projeto

```
tutor-ai/
│
├── electron/                              # MAIN PROCESS (Node.js)
│   ├── main.ts                            # Entry point, cria janela, CSP
│   ├── preload.ts                         # contextBridge (segurança)
│   ├── types.d.ts                         # Declaração do `?raw` import do Vite
│   │
│   ├── ipc/                               # IPC handlers (backend)
│   │   ├── claude.ipc.ts                  # Proxy seguro para API
│   │   ├── database.ipc.ts                # CRUD no SQLite
│   │   ├── files.ipc.ts                   # Upload, leitura de arquivos
│   │   ├── embeddings.ipc.ts              # Gerar/buscar embeddings
│   │   ├── settings.ipc.ts                # API key, preferências
│   │   └── setup.ipc.ts                   # Download do modelo ONNX (progresso via webContents.send)
│   │
│   ├── services/                          # Lógica de negócio
│   │   ├── claude.service.ts              # Chamadas à API do Claude
│   │   ├── embedding.service.ts           # ONNX model loading + embed
│   │   ├── rag.service.ts                 # Chunking + busca + contexto
│   │   ├── quiz-generator.service.ts      # Pipeline de geração de quiz
│   │   └── spaced-repetition.service.ts   # Algoritmo FSRS
│   │
│   ├── database/
│   │   ├── connection.ts                  # Inicializa SQLite (singleton + WAL)
│   │   ├── lancedb.ts                     # Conexão LanceDB + tabela chunks (384-dim)
│   │   ├── schema.sql                     # Criação das tabelas (embutido via ?raw)
│   │   ├── migrations/                    # Alterações futuras
│   │   └── repositories/                  # Queries organizadas por entidade
│   │       ├── subjects.repo.ts
│   │       ├── topics.repo.ts
│   │       ├── sources.repo.ts
│   │       ├── quizzes.repo.ts
│   │       ├── flashcards.repo.ts
│   │       ├── exercises.repo.ts
│   │       ├── conversations.repo.ts
│   │       └── chunks.repo.ts
│   │
│   └── utils/
│       ├── pdf-parser.ts                  # Extração de texto de PDF (pdf-parse)
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
├── .npmrc                                 # Configura node-gyp para compilar nativos contra Electron
├── package.json                           # Dependências e scripts
├── tsconfig.json                          # Raiz (project references)
├── tsconfig.node.json                     # TypeScript config (electron + scripts)
├── tsconfig.web.json                      # TypeScript config (renderer)
├── electron.vite.config.ts                # electron-vite (main + preload + renderer)
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
    → Extrai texto (página por página) — pdf-parse
    → Divide em chunks de ~500 tokens (estratégia abaixo)
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

### Estratégia de chunking

Decidida na v0.2.0:

1. **Quebra primária por parágrafos** (separadores: `\n\n`). Mantém unidades semânticas inteiras quando cabem em 500 tokens.
2. **Parágrafos longos** (>500 tokens) são subdivididos em chunks de ~500 tokens. A contagem usa aproximação `chars / 4` (rápida, sem dependência de tokenizer; suficiente porque o limite é "soft" — o ONNX trunca em 256 tokens internos de qualquer jeito).
3. **Overlap de 50 tokens** entre chunks vizinhos (sliding window). Preserva contexto na fronteira: se a resposta certa estiver "partida" entre dois chunks, ainda aparece em pelo menos um deles na busca.
4. **Lib de extração:** `pdf-parse` — node-only, maduro, suficiente para PDFs acadêmicos típicos. Upgrade para `pdfjs-dist` (Mozilla) só se aparecerem PDFs com layout complexo que quebram.

> Tokenizer de produção (`tiktoken`, `@huggingface/tokenizers`) ficaria mais preciso mas adicionaria dependência nativa. A aproximação `chars / 4` é o trade-off escolhido para a v0.2.0 — pode ser revisitada se a qualidade do RAG cair.

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
├── .apikey                      ← API key encriptada (safeStorage)
├── embeddings/                  ← LanceDB: vetores para busca
├── sources/                     ← PDFs e arquivos originais
│   ├── a1b2c3d4...e5f6.pdf      ← renomeados com SHA-256 do conteúdo (dedupe automático)
│   └── 9c8b7a6...d3e2.txt
└── models/                      ← Modelo ONNX
    └── all-MiniLM-L6-v2.onnx
```

- **API key**: salva via Electron safeStorage (encriptada pelo SO)
- **Backup**: copiar a pasta inteira restaura tudo
- **Reset**: deletar a pasta e o app recria do zero

---

## Segurança

- API key encriptada via safeStorage do Electron (Keychain/Credential Manager/libsecret)
- Em sistemas sem keyring disponível (ex: Linux sem libsecret), o status `EncryptionStatus` é exposto explicitamente como `os-backed | plaintext-fallback | unavailable`. O app avisa o usuário em Settings quando cai em fallback — nunca silenciosamente.
- Frontend (renderer) nunca acessa Node.js, banco, ou API key diretamente
- Toda comunicação via IPC com contratos tipados pelo preload.ts (contextBridge)
- Prepared statements no SQLite (sem SQL injection)
- Nenhum dado sai da máquina exceto chamadas à API do Claude
- Content Security Policy no Electron bloqueia scripts externos (`connect-src` libera apenas `https://api.anthropic.com`)
- Entrada do usuário sanitizada antes de salvar no banco

---

## Padrões de Implementação

Convenções aprendidas durante a v0.1.0 que valem para todas as versões.

### IPC tipado em 3 lugares sincronizados

Cada método IPC vive em três arquivos que precisam ficar coerentes — o TypeScript funciona como guarda:

1. **`src/types/ipc.ts`** — fonte da verdade. Define a `interface IpcApi` com namespaces (`app`, `settings`, `setup`, ...). Inclui `declare global { interface Window { readonly api: IpcApi } }` para o renderer ter `window.api` tipado em todo lugar.
2. **`electron/preload.ts`** — `contextBridge.exposeInMainWorld('api', { ... })` tipado como `IpcApi`. TS valida que o objeto exposto bate com o contrato.
3. **`electron/ipc/<area>.ipc.ts`** — registra os handlers via `ipcMain.handle('namespace:method', ...)`.

Adicionar um IPC novo = editar `IpcApi` e seguir os erros do TS. Não há atalho para "esquecer um lado" — o build quebra.

### Eventos de progresso: `webContents.send` + `ipcRenderer.on`

Funções não atravessam IPC (JSON não serializa código). Para operações longas com progresso, o padrão correto é:

- **Main** envia eventos com `win.webContents.send('canal:progress', { pct, status })`.
- **Preload** registra `ipcRenderer.on('canal:progress', handler)` e expõe ao renderer uma função que recebe um callback. Essa função retorna outra função de cleanup que faz `ipcRenderer.off(...)`.
- **Renderer** chama `api.setup.onProgress(cb)` num `useEffect` e usa o retorno como cleanup.

A função de invoke (ex: `api.setup.downloadModel()`) só resolve a Promise quando termina. O progresso vem por canal separado.

### SQL embutido no bundle via `import ?raw`

`import schema from './schema.sql?raw';` faz o Vite ler o arquivo em build time e embutir o conteúdo como string no bundle. Vantagens:

- Sem cópia de arquivo em runtime — o SQL viaja dentro do binário.
- Refatorar nome/local do `.sql` é refletido pelo TS/Vite.
- Funciona igual em dev e em prod (sem `__dirname` shenanigans).

Requer a declaração em `electron/types.d.ts`:

```ts
declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
```

### Build de módulos nativos no Windows

`better-sqlite3` é um módulo nativo. Em Node 24 + Windows, o build padrão falha no link (`/LTCG:INCREMENTAL` com ClangCL). Solução em `.npmrc`:

```
runtime=electron
target=33.2.0
disturl=https://electronjs.org/headers
msbuild_toolset=v143
```

Isso força node-gyp a compilar contra os headers do Electron com o toolset MSVC v143. O `@electron/rebuild` roda como `postinstall` para garantir recompilação ao trocar versão do Electron.

### Schema idempotente — sem migrations na v0.1.0

Todas as tabelas usam `CREATE TABLE IF NOT EXISTS`. O schema é carregado integral toda vez que o app inicia e nunca destrói nada. Migrations entram quando a primeira mudança de schema acontecer (provável v0.2.0+).

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
    "@lancedb/lancedb": "^0.18.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "uuid": "^10.0.0",
    "pdf-parse": "^1.1.0"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^25.0.0",
    "@electron/rebuild": "^3.6.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@tailwindcss/vite": "^4.0.0",
    "typescript": "^5.6.0",
    "tailwindcss": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/pdf-parse": "^1.1.0"
  },
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

> **Nota sobre nativos no Windows + Node 24:** o `.npmrc` força node-gyp a usar
> os headers do Electron (`runtime=electron`, `target=33.2.0`,
> `disturl=https://electronjs.org/headers`) e o toolset MSVC v143 para evitar
> falhas no `/LTCG:INCREMENTAL` do ClangCL ao compilar `better-sqlite3`. O
> `@electron/rebuild` roda como `postinstall` para garantir que os módulos
> nativos sejam recompilados contra a versão do Electron em uso.

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
# Dependencies
node_modules/

# Build output
dist/
out/
release/

# Environment / secrets
.env
.env.local

# Local databases (created at runtime in userData)
*.db
*.db-journal
*.db-wal
*.db-shm
embeddings/

# ONNX model (downloaded by `npm run setup-models` or via onboarding)
models/*.onnx
models/*.bin
models/*.json
!models/.gitkeep

# OS / editor
.DS_Store
Thumbs.db
.vscode/
.idea/

# TS incremental build
*.tsbuildinfo
```
