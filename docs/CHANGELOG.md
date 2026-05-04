# Changelog — tutor.ai

Releases em ordem reversa.

---

## v0.7.0 (2026-05-04) — Chat inline em pergunta de quiz

### Adicionado
- **Chat inline em cada pergunta de quiz**: botão 💬 "Tirar dúvida" no card da pergunta (durante quiz e em revisão de resultados). Abre área expansível com mini-chat.
- **Multi-turn nativo**: aluno pode fazer várias perguntas seguidas, IA lembra do contexto da troca anterior. Reusa toda a infra do chat global (`conversations` + `messages` + sliding window). Ver [ADR-035](DECISIONS.md#adr-035).
- **System prompt sócrático contextual**: tom adapta ao estado do aluno. Antes de marcar resposta = sócrático (não entrega resposta, faz perguntas guiadas). Após acertar = aprofundar conceitos. Após errar = diagnosticar erro com perguntas. Implementado via `buildQuizTutorSystemPrompt(ctx)` que injeta a pergunta+alternativas+correta+explicação+estado em toda chamada ao Claude (sobrevive ao sliding window). Ver [ADR-036](DECISIONS.md#adr-036).
- **Persistência por pergunta**: cada pergunta de quiz tem sua própria conversation (lazy create). Aluno volta dias depois e vê as dúvidas anteriores.
- **Optimistic UI**: pergunta do aluno aparece imediatamente + indicador "digitando…" enquanto Claude responde.
- **Sliding window 10 → 20 mensagens** no chat global e inline. Cobre conversas mais longas sem perder contexto. Ver [ADR-037](DECISIONS.md#adr-037).

### Arquitetura
- Novo enum value `'quiz_question'` em `ScopeType` (não exige migration SQL — SQLite não valida).
- Novo método `findConversationByScope(scopeType, scopeId)` em `conversations.repo.ts` pra recuperação 1:1.
- Pipeline `sendQuizDoubt` em `chat.service.ts` (separado de `sendMessage`): pula rewriter+RAG, injeta contexto via system prompt.
- 2 IPC handlers novos: `chat:askQuizDoubt` + `chat:getQuizDoubt`.
- Novo componente `QuizDoubtChat` reusa `ChatMessage` (markdown/LaTeX) e `ChatInput` do chat global.
- Novo arquivo `electron/services/prompts/quiz-tutor.ts` com system prompt + builder do contexto.

### Adiado pra v0.7+
- **RAG no chat de quiz inline**: hoje a IA vê só a pergunta+explicação. Pra dúvidas tangenciais ("isso aparece no capítulo X?"), ela admite limite e sugere o chat global. Caminho: adicionar busca vetorial restrita à `source_id` da pergunta. Latência sobe ~1.5-2s. Anotado no [BACKLOG](BACKLOG.md).
- **RAG memory + agentic memory**: pra conversas muito longas e memória entre sessões. Backlog.

### Caveats conhecidos
- Schema antigo (`quiz_questions.doubt_question`, `doubt_response`) fica como **dead columns**. Não populado pelo novo fluxo. Removível em migration futura.

---

## v0.6.1 (2026-05-04) — Fix backfill FTS5

### Corrigido
- Migration de DBs pré-v0.6: o backfill com `INSERT INTO document_chunks_fts(rowid, content) SELECT ...` inseria as rows mas **não populava o índice invertido** em external content tables — `MATCH 'qualquer_palavra'` retornava 0 resultados, deixando o FTS efetivamente desativado pra usuários que migraram de versões anteriores. Corrigido pra usar `INSERT INTO fts(fts) VALUES('rebuild')`, que reconstrói o índice lendo a tabela externa (forma documentada do FTS5).
- Detecção do problema agora usa um probe (palavra real do 1º chunk com MATCH) em vez de só contar rows. Pega o caso onde alguém aplicou o backfill v0.6.0 mas o índice ficou vazio.

### Não afetava
- DBs criados em v0.6+ (ingestão via app): triggers AFTER INSERT funcionam normalmente — só inserts via INSERT-SELECT direto na FTS é que falhavam.

### Bug detectado por
Smoke test empírico em `scripts/compare-rag.ts` — script que compara semantic-only vs FTS-only vs híbrido RRF lado a lado. Vai pro repo como ferramenta de diagnóstico futura.

---

## v0.6.0 (2026-04-29) — RAG híbrido (estrutural + semântico + FTS)

### Adicionado
- **Filtro estrutural antes do RAG semântico**: queries como "resolva o exercício 5" ou "explica o capítulo 3" agora detectam o label estrutural e buscam direto em `structural_label = "exercício 5"`, sem passar pelo embedding. Cobertura PT-BR (exercício, exemplo, questão, problema, capítulo, seção, unidade, aula) + EN (exercise, example, problem, question, chapter, section). Recall ~100% pra queries estruturais explícitas. Ver [ADR-033](DECISIONS.md#adr-033).
- **Full-text search via SQLite FTS5**: nova virtual table `document_chunks_fts` (external content, sem duplicação de dados) com tokenizer `unicode61 remove_diacritics 1` — busca "produção" acha "producao". Triggers AFTER INSERT/DELETE/UPDATE mantêm índice sincronizado. Ranqueamento via BM25.
- **Hybrid search via Reciprocal Rank Fusion (RRF)**: quando não há filtro estrutural, RAG roda semantic search **e** FTS em paralelo, fundindo as duas listas com `score = Σ 1/(60 + rank)`. Recall melhor em queries técnicas (termos raros, jargão, nomes próprios) sem perder queries parafraseadas. Ver [ADR-034](DECISIONS.md#adr-034).
- **Backfill automático do índice FTS** no boot: `applyMigrations` detecta DBs com chunks pré-v0.6 e repopula o FTS via `INSERT ... SELECT` (triggers só pegam chunks novos).

### Mudado
- `rag.service.ts`: `searchByQuery` agora tem 3 fluxos (estrutural → híbrido → fallback). Função `searchSemantic` extraída pra isolar a parte vetorial.
- `chunks.repo.ts`: novos helpers `listChunksByStructuralLabel` e `searchChunksByFts` (com `FtsResult { chunk, rank }`).
- `schema.sql`: adicionada FTS5 virtual table + 3 triggers de sincronização.

### Adiado pra v0.7+
- **OCR pra PDFs escaneados**. Análise mostrou stack pesado (~50MB: tesseract.js + pdfjs-dist + @napi-rs/canvas) e setup de Vite não-trivial. Versão dedicada faz mais sentido. Workaround: usar smallpdf/Adobe pra OCR antes de subir o PDF.

---

## v0.5.1 (2026-05-04) — Markdown/LaTeX rendering no chat

### Corrigido
- Chat retornava markdown/LaTeX cru (`$$P(X=8)$$`, `**negrito**`, tabelas, listas, headings) em vez de renderizar visualmente. Bug visível em qualquer resposta com matemática — crítico pra estudo de exatas.

### Adicionado
- `react-markdown` + `remark-gfm` (tabelas, GFM) + `remark-math` + `rehype-katex` + `katex` pra renderização completa.
- Components customizadas em `ChatMessage.tsx` mapeando markdown → estilos Tailwind do tema dark (sem dependência do typography plugin).
- CSS do KaTeX importado globalmente em `main.tsx`.
- Mensagens do **usuário** continuam plain text (preservam quebras de linha) — evita que `*texto*` digitado vire itálico inesperado.

---

## v0.5.0 (2026-05-04) — RAG enhancements

### Adicionado
- **Query rewriting** (RAG conversacional): perguntas referenciais como "resolva esse exercício" ou "explica isso" agora funcionam. Antes do RAG, uma chamada extra ao Claude reescreve a pergunta usando histórico recente. Ver [ADR-029](DECISIONS.md#adr-029).
- **Page numbers nos chunks**: pdf-parse agora extrai texto por página via callback `pagerender`. Cada chunk carrega `pageNumber` (1-based) e a UI/IA cita "página 14" em vez de "chunk 26". Ver [ADR-030](DECISIONS.md#adr-030).
- **Estrutura detectada**: novo `structure-detector.ts` aplica regex pra reconhecer "Exercício N", "Capítulo N", "Seção N", "Exemplo N", "Questão N", "Problema N", "Aula N", "Unidade N" (PT-BR + EN). Cada chunk ganha `structuralLabel`; UI mostra como chip 🟣 ao lado da fonte; prompt inclui no contexto. Ver [ADR-031](DECISIONS.md#adr-031).
- **Schema migrations leves**: `applyMigrations(db)` no boot roda `ALTER TABLE ADD COLUMN` quando necessário, baseado em `PRAGMA table_info`. Idempotente, sem framework. Ver [ADR-032](DECISIONS.md#adr-032).

### Mudado
- `text-chunker.ts`: nova API `chunkPages(pages)` substitui `chunkText(text)` no pipeline (chunks nunca cruzam fronteira de página). `chunkText` mantido pra retrocompat.
- Prompt do chat-tutor instrui IA a citar página + label estrutural quando disponíveis.

### Corrigido
- Botão flutuante 💬 cobria conteúdo no fim do scroll (lista de quizzes anteriores, etc). Adicionado `pb-24` (96px) nas páginas com listas longas.

### Caveats conhecidos
- PDFs ingeridos em versões anteriores ficam com `pageNumber` e `structuralLabel` NULL. Pra ter os benefícios, **delete e re-suba** os PDFs.
- Sem filtro estrutural ainda ("exercício 5" busca via embedding, não via filtro `structural_label = "exercício 5"`). Anotado no backlog como próximo passo natural.

---

## v0.4.0 (2026-05-03) — Chat com RAG

### Adicionado
- **Chat com RAG (Retrieval-Augmented Generation)**: pergunte algo sobre seu material e a IA responde **só com base nos PDFs subidos**, citando fontes. Ver [ADR-025](DECISIONS.md#adr-025).
- **Botão flutuante 💬** no canto inferior direito (sempre visível), abre painel lateral com conversas.
- **Escopo automático** detectado pela rota: TopicView → busca no tópico inteiro; SubjectView → matéria inteira. Ver [ADR-026](DECISIONS.md#adr-026).
- **Conversas persistentes** por escopo: lista com preview, contagem de mensagens, hover de renomear/excluir.
- **Sliding window de 10 mensagens** mantém contexto recente sem custo absurdo. Ver [ADR-027](DECISIONS.md#adr-027).
- **Citações inline**: cada resposta vem com chunks usados (filename + índice + similaridade%), expandíveis pra ver conteúdo.
- **Optimistic UI**: pergunta aparece imediatamente + indicador "digitando…" enquanto Claude responde.
- **System prompt rígido** (`chat-tutor.ts`): IA só responde do material, declina conhecimento geral, cita fontes, diz "não encontrei" quando aplicável. Sem alucinação.

### Corrigido
- **Bug de escopo**: conversa criada num tópico passou a buscar em outro tópico se o usuário navegasse pelo app sem fechar o painel. Agora o escopo é fixo na conversa (lido do DB), não da rota atual. Ver [ADR-026](DECISIONS.md#adr-026).

### Caveats conhecidos
- **Query rewriting ainda não implementado** (alta prioridade no backlog): perguntas referenciais como "resolva esse exercício" ou "explica isso" podem confundir o RAG porque a query é só a última mensagem do usuário, sem histórico. Solução planejada: chamada extra ao Claude pra reescrever a pergunta usando contexto.
- **Sem streaming**: resposta vem completa após ~3-8s. Sem indicador token-a-token. Ver backlog.

---

## v0.3.0 (2026-05-03) — Quiz

### Adicionado
- **Pipeline de geração de quiz em 3 etapas** (análise → geração → validação) usando `claude-sonnet-4-6`. Ver [ADR-022](DECISIONS.md#adr-022).
- **Cache da análise** em `sources.extracted_concepts` — quizzes futuros do mesmo material pulam a etapa 1.
- **QuizSetup**: tela de configuração com seleção de materiais, tema livre opcional, "Sugerir temas" via IA, slider de número de perguntas (3-30), tipo (múltipla escolha / V-F / misto), título customizável.
- **QuizPlay**: jogada com pergunta + 4 opções (ou V-F), confirmação revela cores corretas/erradas + explicação detalhada.
- **QuizResults**: score grande, revisão das perguntas erradas, opção colapsável das certas, mensagem motivacional por % de acerto.
- **Histórico de quizzes** no TopicView (`QuizHistoryList`): lista quizzes anteriores com status (completo / em andamento) e score.
- **Pausar e continuar quiz**: botão "Sair (continua depois)" no QuizPlay; quiz fica como "em andamento" no histórico; clicar retoma de onde parou (respostas dadas ficam salvas).
- **Refazer quiz** (zero tokens): limpa respostas mas mantém perguntas, permite responder de novo.
- **Renomear quiz** a qualquer momento via ✏️ no QuizResults ou no item do histórico.
- **Excluir quiz** via 🗑️ no QuizResults ou no item do histórico, com confirmação modal.
- **Pipeline tolerante a falhas** ([ADR-024](DECISIONS.md#adr-024)): per-source error handling na análise, parser parcial de JSON pra recuperar perguntas truncadas, validação por pergunta sem abortar quiz inteiro.
- **Guard de OCR**: PDFs com <300 chars de texto extraível agora são rejeitados na ingestão com mensagem clara ("provavelmente é uma imagem ou scan, OCR não suportado").
- `Slider` component (UI) pra inputs numéricos com range.

### Mudado
- `IngestResult.pageCount` virou opcional (fast-path do dedup não lê PDF).

### Corrigido
- Erros da Anthropic API (chave inválida, sem créditos, rate limit) agora viram mensagens em PT amigáveis em vez do JSON cru.
- Resposta de geração truncada (max_tokens) agora é detectada via `stop_reason` e o parser recupera as perguntas completas.

---

## v0.2.1 (2026-05-02) — Dedup de chunks por content_hash

### Adicionado
- Fast-path no pipeline de ingestão: quando o mesmo PDF (mesmo SHA-256) entra em outro tópico, copia chunks (SQLite) + vetores (LanceDB) da source existente em vez de re-extrair/re-chunkar/re-embedar. ~95% mais rápido pra PDFs repetidos. Ver [ADR-018](DECISIONS.md#adr-018).
- `IngestResult.reused` flag pra clientes diferenciarem fast-path de slow-path.

### Refatorado
- `database.ipc.ts` (god file) dividido em `subjects.ipc.ts`, `topics.ipc.ts`, `sources.ipc.ts`. Pattern espelha `settings.ipc.ts`/`setup.ipc.ts`/`files.ipc.ts`. Ver [ADR-020](DECISIONS.md#adr-020).
- Helpers de chunk movidos de `lancedb.ts` pra `chunks.repo.ts` (chunk é entidade conceitual única, mesmo que armazenada em 2 stores). `lancedb.ts` fica só com conexão + bootstrap. Ver [ADR-021](DECISIONS.md#adr-021).
- Documentação reorganizada em `docs/DECISIONS.md` (ADRs), `docs/BACKLOG.md` (tech debt), `docs/CHANGELOG.md` (este arquivo). `CLAUDE.md` enxugado pra ser entry point.

### Corrigido
- `query().where().toArray()` do `@lancedb/lancedb` travando indefinidamente — substituído por scan + filter em JS. Ver [ADR-019](DECISIONS.md#adr-019).
- Float32Array vindo do Apache Arrow agora é convertido pra `number[]` antes de re-inserir.

---

## v0.2.0 (2026-05-02) — Organização

### Adicionado
- CRUD completo de **Subjects** (matérias) com emoji + cor.
- CRUD completo de **Topics** (tópicos por matéria).
- Upload de **PDFs** por tópico:
  - Botão "+ Subir PDF" abre dialog do SO em multi-select
  - Drag-and-drop de múltiplos arquivos com overlay visual
- Pipeline de ingestão automática:
  - Extração de texto via `pdf-parse`
  - Chunking por parágrafo + sliding window com 50 tokens de overlap (ver [ADR-012](DECISIONS.md#adr-012))
  - Embeddings via ONNX (all-MiniLM-L6-v2)
  - Persistência: SQLite (texto) + LanceDB (vetores 384-dim)
- Dedup de **arquivos no disco** via SHA-256 (mesmo PDF em múltiplos tópicos = 1 arquivo). Ver [ADR-016](DECISIONS.md#adr-016).
- Rotas `/subjects/:id` (SubjectView) e `/topics/:id` (TopicView).
- `scripts/inspect-db.ts` — dump do estado do DB usando `node:sqlite` builtin.

### Mudado
- **Tokenizer real (BERT)** via `@xenova/transformers` substituiu o tokenizer fake da v0.1.0. Embeddings agora são semanticamente válidos. Ver [ADR-013](DECISIONS.md#adr-013) e [ADR-014](DECISIONS.md#adr-014).
- Source.chunkCount adicionado via LEFT JOIN COUNT — uma query a menos por card.

### Caveat conhecido (resolvido em v0.2.1)
- Chunks duplicados quando mesmo PDF entra em múltiplos tópicos. Funcional, mas desperdiça compute.

---

## v0.1.0 (2026-04-29) — Fundação

### Adicionado
- App Electron + React + Vite + TypeScript estrito.
- SQLite (12 tabelas) + LanceDB (vetor 384-dim) inicializados na primeira execução.
- ONNX runtime com all-MiniLM-L6-v2 baixado durante o Onboarding.
- API key da Anthropic encriptada via `safeStorage` (com fallback explícito `os-backed | plaintext-fallback | unavailable`).
- Design system: Button, Card, Input, Modal, Progress.
- Layout: AppLayout (Sidebar + Outlet), Header.
- Onboarding: cola API key → baixa modelo ONNX com progresso → home.
- Settings: trocar API key, "Limpar todos os dados".
- HashRouter pra compat com `file://` em produção. Ver [ADR-002](DECISIONS.md#adr-002).
- Bundler `electron-vite v5` com HMR nas 3 camadas. Ver [ADR-001](DECISIONS.md#adr-001).
- Tailwind v4 CSS-first via `@theme {}`. Ver [ADR-003](DECISIONS.md#adr-003).
- Build de nativos via `.npmrc` + `@electron/rebuild` postinstall pra Node 24 / Windows. Ver [ADR-005](DECISIONS.md#adr-005), [ADR-006](DECISIONS.md#adr-006).

### Caveat conhecido (resolvido em v0.2.0)
- Tokenizer falsificado (hash de char codes) produzia embeddings sem sentido semântico. Pipeline mecânico funcionava; busca não traria resultados úteis.
