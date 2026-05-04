# Changelog — tutor.ai

Releases em ordem reversa.

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
