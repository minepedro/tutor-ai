# Changelog — tutor.ai

Releases em ordem reversa.

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
