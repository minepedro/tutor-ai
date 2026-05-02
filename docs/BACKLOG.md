# Backlog — tutor.ai

Lugar único pra "o que falta fazer" que não está no roadmap atual ([TODO.md](TODO.md)).

**Regra:** item resolvido **sai daqui** (vai pra commit + CHANGELOG). Não fica `[x] feito`.

---

## Tech Debt

- [ ] **Vitest + testes do chunker e ingestion service** — sem testes automatizados. Pra app com pipeline de IA, refatorar é arriscado. Prioridade: **medium**, antes da v0.4.0 (chat com RAG).
- [ ] **Sistema de migrations** — schema é idempotente hoje (`CREATE TABLE IF NOT EXISTS`), mas a primeira mudança de coluna existente vai dar pau. Plano: `umzug` ou impl manual quando a primeira mudança aparecer.
- [ ] **ONNX em batch ou worker thread** — embedding hoje é sequencial single-thread. Pra PDFs >1000 chunks demora minutos. Solução: usar `embed()` com batch dim do ONNX (refactor pequeno em embedding.service.ts) ou Worker Threads (refactor médio).
- [ ] **Dividir `src/types/ipc.ts`** quando passar de 250 linhas. Pra `types/ipc/` com 1 arquivo por feature + index.ts re-exportando.
- [ ] **CSP em produção pra HuggingFace Hub** — primeira ingestão precisa baixar tokenizer.json. Hoje funciona porque o download roda no main process (CSP não se aplica). Revisar quando ARM64/Mac entrar.

## Features adiadas

- [ ] **Opção A do dedup: tabela `documents` compartilhada** — em vez de duplicar chunks/vetores quando mesmo PDF entra em N tópicos, ter 1 tabela `documents` (por content_hash) que múltiplas sources referenciam. Refactor médio de schema. Vale fazer só se virar problema de escala (≫50 PDFs compartilhados).
- [ ] **OCR pra PDFs escaneados** — `pdf-parse` retorna vazio pra PDFs imagem. Adicionar `tesseract.js` como fallback quando `extractPdfText` retornar string vazia. Custo: ~30MB do binário tesseract.
- [ ] **Suporte a outros formatos** — `.txt`, `.md`, URL, paste de texto. Schema já tem `file_type: 'pdf' | 'txt' | 'url' | 'paste'`. Implementar handlers diferenciados em `files.ipc.ts`.
- [ ] **Multi-modelo de embedding** — hoje só all-MiniLM-L6-v2 (384 dims, qualidade média). Permitir trocar por nomic-embed (768 dims, qualidade superior) via Settings. Requer migration pra trocar dim do LanceDB.
- [ ] **Importar/exportar dados** — zipar `userData/` pra backup; restore. Útil pra trocar de máquina.
- [ ] **AGENTS.md compatibility** — quando virar v1.0 público, criar `AGENTS.md` como cópia/symlink do `CLAUDE.md` pra ferramentas que não são Claude Code (Cursor, Aider, OpenAI Codex).

## Decisões pendentes

- [ ] **Modo "conhecimento geral" no Quiz** — usuário digita tema sem ter material. Hoje rejeita ("tema não encontrado no material"). Vale liberar com flag `modo conhecimento geral`? Tradeoff: alinhamento com "estudo do SEU material" vs flexibilidade.
- [ ] **Modelo Anthropic padrão pra Quiz** — Sonnet vs Opus. Sonnet mais barato e suficiente pra geração de quiz. Opus pode valer pra modo `quality`. Definir antes de começar v0.3.0.
- [ ] **Cancelar ingestão em andamento** — botão na UI durante ingestão. Requer abortar IPC handler + limpar estado parcial. Complexidade média; ainda não é dor real porque ingestão é rápida.

## Reativos (em standby)

- [ ] **Issue do `query().where()` travando no `@lancedb/lancedb` 0.18** — workaround atual em ADR-019 é scan + filter JS. Reavaliar quando subir versão do LanceDB.
