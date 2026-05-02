# tutor.ai — Contexto do Projeto

## Estado Atual
**v0.2.0 (Organização) — concluída.** Pendente apenas commits + tag + push.
Próxima versão a iniciar: **v0.3.0** (geração de quiz via API Anthropic, pipeline de 3 etapas: análise → geração → validação).
Última sessão: 2026-05-02

**Versionamento:** v0.1.0 (Fundação) está no `origin/main` (tag `v0.1.0` no commit `0294e2a`). v0.2.0 está toda no working tree, prestes a ser commitada e taggeada.

## O que já está implementado

### v0.1.0 — Fundação (concluída, em `origin/main`)
- Electron + React + Vite + TS estrito + SQLite + LanceDB + ONNX
- API key encriptada via `safeStorage` (com fallback `os-backed | plaintext-fallback | unavailable`)
- Onboarding com download do modelo ONNX
- Design system (Button, Card, Input, Modal, Progress) + AppLayout
- Settings com "Limpar tudo"
- 12 tabelas no schema SQLite
- Tag `v0.1.0` em https://github.com/minepedro/tutor-ai/tree/v0.1.0

### v0.2.0 — Organização (working tree, pronto para commit)

**Repositories pattern (CRUD por entidade):**
- [electron/database/repositories/subjects.repo.ts](electron/database/repositories/subjects.repo.ts) — CRUD com prepared statements + map snake_case ↔ camelCase
- [electron/database/repositories/topics.repo.ts](electron/database/repositories/topics.repo.ts) — escopado por subjectId; FK CASCADE
- [electron/database/repositories/sources.repo.ts](electron/database/repositories/sources.repo.ts) — `findSourceByHash`, `chunkCount` via LEFT JOIN COUNT
- [electron/database/repositories/chunks.repo.ts](electron/database/repositories/chunks.repo.ts) — `createChunksBatch` em transação (~10x mais rápido)

**IPC + tipos:**
- [electron/ipc/database.ipc.ts](electron/ipc/database.ipc.ts) — handlers `subjects:*`, `topics:*`, `sources:*` com type guards manuais (sem zod)
- [electron/ipc/files.ipc.ts](electron/ipc/files.ipc.ts) — `pickAndUpload` (multi-select), `uploadFromPaths` (drag-drop), `deleteSource` (limpa LanceDB + SQLite + arquivo)
- [electron/ipc/embeddings.ipc.ts](electron/ipc/embeddings.ipc.ts) — `ingest` com progresso via `webContents.send`
- [src/types/ipc.ts](src/types/ipc.ts) — `Subject`, `Topic`, `Source`, `EmbeddingProgress` + APIs respectivas
- [electron/preload.ts](electron/preload.ts) — namespaces `subjects`, `topics`, `sources`, `files`, `embeddings`; `getDroppedPath` síncrono via `webUtils.getPathForFile`

**Pipeline de ingestão:**
- [electron/utils/pdf-parser.ts](electron/utils/pdf-parser.ts) — `extractPdfText` via `pdf-parse`, normaliza whitespace
- [electron/utils/text-chunker.ts](electron/utils/text-chunker.ts) — quebra por parágrafo + sliding window com overlap; `chars / 4` aproximação de tokens
- [electron/services/ingestion.service.ts](electron/services/ingestion.service.ts) — orquestra extract → chunk → embed → SQLite + LanceDB; reporta progresso 0→100% em 5 fases
- [electron/services/embedding.service.ts](electron/services/embedding.service.ts) — **tokenizer real do BERT** via `@xenova/transformers` (dynamic import por causa de ESM); mean pool com máscara

**Frontend:**
- Hooks: [useSubjects](src/hooks/useSubjects.ts), [useTopics](src/hooks/useTopics.ts), [useSources](src/hooks/useSources.ts) — refetch após mutação; `useSources` dispara ingestão em série após upload
- Componentes: [SubjectCard](src/components/SubjectCard.tsx) (com cor + emoji), [SubjectModal](src/components/SubjectModal.tsx) (12 emoji presets + 8 color presets), [TopicCard](src/components/TopicCard.tsx), [TopicModal](src/components/TopicModal.tsx), [SourceCard](src/components/SourceCard.tsx) (barra de progresso inline durante ingest)
- Páginas: [Home](src/pages/Home.tsx) (grid de matérias), [SubjectView](src/pages/SubjectView.tsx) (lista de tópicos), [TopicView](src/pages/TopicView.tsx) (lista de sources com **drag-and-drop** + multi-select)
- Rotas: `/subjects/:id`, `/topics/:id` em [App.tsx](src/App.tsx) + helpers `subjectViewPath`, `topicViewPath` em [constants.ts](src/lib/constants.ts)

**Scripts:**
- [scripts/inspect-db.ts](scripts/inspect-db.ts) — dump do estado do DB usando `node:sqlite` builtin (não precisa rebuild de nativo). Roda com `npx tsx`.

## Decisões Técnicas (acumuladas v0.1.0 + v0.2.0)

| Decisão | Por quê |
|--|--|
| **`electron-vite@^5`** | v2 conflita com Vite 6 (peer deps). v5 unifica main/preload/renderer com HMR. |
| **`HashRouter`** | Compatível com `file://` em produção do Electron. |
| **Tailwind v4 (CSS-first)** | Sem `tailwind.config.ts` — config via `@theme {}` em globals.css. Sem PostCSS — usa `@tailwindcss/vite`. |
| **`@lancedb/lancedb`** (não `vectordb`) | `vectordb` foi renomeado upstream. |
| **`@electron/rebuild`** (não `electron-rebuild`) | Pacote antigo descontinuado. Roda como `postinstall`. |
| **`.npmrc` para prebuilds** | Necessário pra `better-sqlite3` no Node 24 + Windows. Força `runtime=electron`, `target=33.2.0`, `disturl`, `msbuild_toolset=v143`. |
| **SQL via `?raw` import** | Vite embute o `.sql` como string no bundle. |
| **IPC tipado em 3 lugares** | `src/types/ipc.ts` → `electron/preload.ts` → `electron/ipc/*.ipc.ts`. |
| **Eventos de progresso via `webContents.send`** | Funções não serializam por IPC. Padrão event-based. |
| **CSP `connect-src 'self' https://api.anthropic.com`** | Única chamada externa permitida. |
| **Schema idempotente** | `CREATE TABLE IF NOT EXISTS`. Migrations entram quando schema mudar. |
| **`pdf-parse` (não pdfjs-dist)** | Maduro, simples, suficiente para PDFs acadêmicos típicos. |
| **Chunking: parágrafo + sliding window com overlap 50 tokens** | Preserva contexto em fronteiras. Aproximação `chars / 4` evita dependência de tokenizer pesado. |
| **Tokenizer real (`@xenova/transformers`)** | Substituiu o tokenizer fake da v0.1.0. Dynamic import porque é ESM-only e o main process é CommonJS. |
| **Cache do tokenizer em `userData/models/transformers-cache/`** | ~1MB, baixado na primeira ingestão. Reusa pasta dos modelos. |
| **Repositories pattern** | Toda query de uma entidade num arquivo. Facilita refactor e testes. |
| **CRUD via `database.ipc.ts` agrupado** | 1 arquivo para entidades read-only/CRUD; `files.ipc.ts` separado para operações com efeito colateral em disco. |
| **SHA-256 para dedup de arquivos** | Mesmo conteúdo = mesmo hash = 1 arquivo no disco. v0.2.0 ainda duplica chunks (resolvido em v0.2.1). |
| **Drag-and-drop via `webUtils.getPathForFile`** | Substituto do `file.path` removido no Electron 32+. Exposto via preload (mesmo process do drag event). |
| **DevTools `mode: 'detach'`** | Janela separada, mais espaço para o app. |

## Problemas Resolvidos

### v0.1.0
1. `electron-vite@2.3.0` peer dep conflict com Vite 6 → subir pra v5
2. `electron-rebuild` descontinuado → `@electron/rebuild`
3. `better-sqlite3` falha no Node 24 / Windows (ClangCL) → `.npmrc` com MSVC v143
4. electron-vite "No entry file found" → `build.rollupOptions.input: { index: ... }`
5. v5 não auto-detecta entry → declarar explícito
6. `externalizeDepsPlugin` deprecated em v5 → remover do config
7. Callback de progresso não serializa via IPC → `webContents.send` + `ipcRenderer.on`
8. Onboarding não navegava → state callback (`onComplete: () => setHasKey(true)`)
9. `noUncheckedIndexedAccess` quebrava `meanPool` → `result[j] = (result[j] ?? 0) + ...`
10. `NodeJS.Platform` não existia no renderer → definir `Platform` literal local

### v0.2.0
11. **41+41 chunks duplicados** quando mesmo PDF entra em múltiplos tópicos → mecanismo dedupa só o **arquivo no disco** (via SHA-256), não os chunks. Backlog v0.2.1 (Opção B: copiar chunks por hash).

12. **Tokenizer fake produzia embeddings sem sentido semântico** → trocado por `@xenova/transformers` (BERT real). Mas é ESM-only:

13. **`ERR_REQUIRE_ESM` ao iniciar app após instalar `@xenova/transformers`** → o pacote é ESM-only e o main process é bundleado como CommonJS. Fix: dynamic `import()` em vez de `import` estático. `import type` continua funcionando para os tipos.

14. **LanceDB `add()` rejeitava `ChunkVectorRecord[]` strict** → cast `as unknown as Array<Record<string, unknown>>` no boundary. A interface fica estrita pra callers.

15. **Per-fase commits "atômicos" não eram realmente atômicos** porque arquivos como `main.ts`, `preload.ts`, `types/ipc.ts` foram tocados em várias fases. Solução: agrupar commits por **tema** (db, ipc, embeddings, ui) em vez de por fase, exceto onde a granularidade ajuda.

## Próximos Passos

### v0.2.0 — Verificação ✅
- [x] `npm run typecheck` passa
- [x] Subjects: criar/editar/excluir + grid + modal — funciona
- [x] Topics: navegação `/subjects/:id` + criar/editar/excluir — funciona
- [x] Sources: navegação `/topics/:id` + upload (botão e drag-drop) + dedup por hash — funciona
- [x] Pipeline: extrai texto + chunks + embeddings + persiste em SQLite e LanceDB — funciona
- [x] BERT real: ingestão sem erro, embeddings gerados — confirmado via `inspect-db.ts`
- [x] Drag-and-drop com overlay visual + multi-arquivo em série — funciona

### Commits da v0.2.0 (a fazer)

A serem criados em ordem **temática** (não por fase, por causa de arquivos compartilhados):
1. `chore(deps): pdf-parse + @xenova/transformers, bump v0.2.0`
2. `feat(db): repositories layer (subjects/topics/sources/chunks)`
3. `feat(ipc): database, files and embeddings handlers + typed contracts`
4. `feat(embeddings): full ingestion pipeline with real BERT tokenizer`
5. `feat(ui): subjects/topics/sources CRUD with drag-and-drop upload`
6. `chore(scripts): db inspector via node:sqlite`
7. `docs(context): update CLAUDE.md for v0.2.0`

Tag `v0.2.0` no último commit funcional (5 — UI). Depois `git push origin main --tags`.

### Backlog v0.2.1
- **Dedup de chunks por content_hash (Opção B):** quando o mesmo PDF entra em múltiplo tópico, copiar os chunks da source existente em vez de re-processar (~30 linhas em `useSources.upload` ou no backend).

### v0.3.0 — Quiz (próxima versão)
- Pipeline de 3 etapas: `quiz-analysis.ts` → `quiz-generation.ts` → `quiz-validation.ts`
- `claude.service.ts` (chamadas à API com error handling)
- `claude.ipc.ts` (proxy seguro)
- `quizzes.repo.ts`, `useQuiz.ts`
- Telas: QuizSetup, QuizPlay (com QuizCard, QuizOption, QuizExplanation), QuizResults
- Modos: `quick` (1 chamada) vs `quality` (3 chamadas)

### v0.4.0+ — Chat com RAG, flashcards (SRS), exercícios

## Convenções do Projeto
- TypeScript estrito, sem `any`
- Sem ORM, queries SQL diretas (better-sqlite3)
- IPC tipado via contextBridge
- Commits convencionais (feat:, fix:, etc)
- Dark theme padrão
- Comentários e UI em português; identificadores em inglês

## Notas para o Claude Code
- O dev não é familiar com TypeScript, explicar conceitos avançados quando aparecerem (`interface` vs `type`, generics, `declare global`, `keyof`, `as const`, dynamic import vs static import)
- Perguntar antes de decisões fora do ARCHITECTURE.md (e antes de editar o ARCHITECTURE.md em si)
- Atualizar CLAUDE.md proativamente quando algo relevante mudar
- Sempre rodar `npm run dev` para validar antes de encerrar
- Nunca rodar `git push` ou `gh pr create` sem permissão explícita
- Mexeu em `electron/main.ts` ou `electron/preload.ts`? Avisar pra matar e re-rodar `npm run dev` (HMR não cobre o main process)
