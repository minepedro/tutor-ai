# Backlog — tutor.ai

Lugar único pra "o que falta fazer" que não está no roadmap atual ([TODO.md](TODO.md)).

**Regra:** item resolvido **sai daqui** (vai pra commit + CHANGELOG). Não fica `[x] feito`.

---

## 🔥 Próxima sprint (alta prioridade)

- [ ] **Modelos locais (Ollama) com identificador de risco** — Suporte dual: usuário escolhe entre **API Anthropic** (default, qualidade alta) ou **modelo local via Ollama** (privacidade, offline, sem custo recorrente).

  **Arquitetura proposta:**
  - Settings ganha aba "Modelos" com:
    - Toggle Provider: `anthropic | ollama`
    - Se Ollama: dropdown de modelos pré-curados + URL do Ollama (default `localhost:11434`)
    - Toggle de embedder: `local-onnx | ollama-nomic | ollama-mxbai`
  - Refactor `claude.service.ts` → `llm.service.ts` com adapter pattern (Anthropic SDK | Ollama HTTP)
  - Refactor `embedding.service.ts` igual
  - Nova tabela LanceDB ou coluna `embedder_id` em sources pra suportar dimensões diferentes (384 vs 768 vs 1024)
  - Schema migration pra Settings ganhar campos novos

  **Identificador de risco** (decisão importante do Pedro 2026-05-04): cada modelo da lista vem com **scorecard visual** indicando confiabilidade por tarefa:
  ```
  Qwen 3 14B Q4_K_M
  ✅ Português  ✅ Quiz simples  ⚠️ Matemática avançada  ❌ Cálculo complexo
  Recomendado pra: leituras, conceitos, química
  Não recomendado pra: provas de cálculo II, álgebra avançada

  DeepSeek R1 Distill 14B
  ✅ Matemática  ✅ Raciocínio  ⚠️ Geração criativa  ✅ Português
  Recomendado pra: exercícios resolvidos, demonstrações

  Claude Sonnet 4.6 (API)
  ✅ Tudo  💰 Pago por uso
  ```

  Critérios pro scorecard: benchmarks conhecidos (MMLU, MATH, HumanEval, MTEB pra embedders) + smoke tests internos do app (quiz de matemática conhecido, RAG fidelity test).

  **Botão "Testar modelo no meu material"**: roda quiz pré-definido + chat sample, mostra resultado pra usuário avaliar antes de commitar.

  **Estimativa:** v0.9.0 ou v1.0.0. Feature grande (~3-4 sessões).

- [ ] **OCR pra PDFs escaneados** — Após análise mais cuidadosa em 2026-05-04, OCR exige stack pesado: `tesseract.js` (~5MB lib + ~25MB modelos PT/EN) + `pdfjs-dist` (renderizar PDF→imagem, config Vite específica) + `@napi-rs/canvas` (canvas Node cross-platform). Total +50MB no app. Performance: 5-30s por página. Pra livro de 200 páginas = ~1h de OCR. Requer UX detalhada (progresso, cancelamento, idiomas). Versão dedicada porque setup é doloroso e edge cases (layout complexo, tabelas, fórmulas em imagem) precisam de atenção. Workaround atual pro usuário: usar [smallpdf.com/pdf-ocr](https://smallpdf.com/pdf-ocr) ou Adobe pra converter PDF imagem → PDF texto antes de subir.

## 🚀 Roadmap das próximas grandes features

Pensadas em sessão 2026-05-04. Estimativas e propostas de UX detalhadas.

### v0.8.0 — Sidebar redesign + Chat fullscreen

Reorganização completa da navegação. Hoje o sidebar é minimalista (Início + Configurações). Conforme app cresce, vira gargalo.

**Proposta A — "Notion-style" (recomendada)**

```
🎓 tutor.ai
├─ 🏠 Início (dashboard com stats)
├─ 💬 Chat (tela cheia, ver abaixo)
├─ 📚 Matérias
│   ├─ Cálculo II
│   │   ├─ Derivadas
│   │   └─ Integrais
│   ├─ História da Arte
│   └─ + Nova matéria
├─ 🎯 Atividades
│   ├─ Quizzes (lista global, todos os tópicos)
│   ├─ Flashcards (futuro)
│   └─ Exercícios (futuro)
└─ ⚙️ Configurações
```

Vantagens: hierarquia natural pra app de estudo, expansível, familiar (Notion/Obsidian).

**Chat fullscreen (rota `/chat`):**

Layout 3 colunas:
```
┌────────────┬──────────────┬─────────────┐
│ Conversas  │ Mensagens    │ Fontes      │
│ anteriores │ da conversa  │ (chunks da  │
│            │              │  resposta)  │
│ [+ Nova]   │              │             │
│ Conv 1     │ [input]      │             │
│ Conv 2     │              │             │
└────────────┴──────────────┴─────────────┘
```

Topo da coluna do meio: **seletor de escopo**:
- Tópico (1)
- Matéria (1)
- 🌐 **Global** (todos os PDFs do app) — requer adicionar `scope_type='global'` no schema
- Multi-seleção (futuro v0.9: requer tabela `conversation_scopes`)

**v0.8.0 entrega:** Notion-style sidebar + Chat fullscreen com escopos Tópico/Matéria/Global. Multi-seleção fica pra depois.

**Custo estimado:** 2-3 sessões. Refactor de `Sidebar`, nova rota `/chat`, ajuste no schema pra `scope_type='global'`, novo mini-componente de seletor de escopo.

### v0.9.0+ — Multi-escopo no chat

Tabela nova `conversation_scopes (conversation_id, scope_type, scope_id)` pra suportar conversas que abrangem múltiplas matérias/tópicos selecionados manualmente. UI: dropdown com checkboxes em árvore (Matéria > Tópicos).

## Robustez / Segurança

- [ ] **Rate limit / circuit breaker pra Anthropic API** — hoje, se um bug fizer loop em `complete()`, drena créditos da chave em minutos. Pra local solo é tolerável; pra distribuir o app pra amigos com sua chave e principalmente pra versão web é **obrigatório**. Implementação simples local: `MAX_CALLS_PER_MINUTE` em variável + contador in-memory em `claude.service.ts` (~30 linhas). Web: Upstash Redis + ratelimit middleware.
- [ ] **Health check pós-`electron-rebuild`** — `postinstall: electron-rebuild` rebuilda binários nativos (better-sqlite3) pra Electron. Se falhar, app abre e quebra na primeira query. Sem visibilidade hoje. Adicionar smoke test pós-install que valida `getDb().prepare('SELECT 1').get()` antes de declarar sucesso.
- [ ] **Backup automático do userData** — se `database.db` corromper (queda de luz no meio de write), aluno perde tudo. WAL ajuda mas não é garantia. Adicionar botão "Fazer backup agora" em Settings que zipa `%APPDATA%/tutor-ai/` pra pasta de backups com data. Ver também "Importar/exportar dados" abaixo (relacionado).

## Observabilidade

- [ ] **Substituir `console.log` por `electron-log` + Sentry** — hoje sem visibilidade do que aconteceu quando dá erro. Pra distribuir pra amigos: `electron-log` grava local. Pra produção web futura: Sentry.
- [ ] **Anthropic structured output (JSON schema nativo)** — hoje usamos `parseLooseJsonArrayPartial` em `quiz-generation.ts` pra recuperar de respostas malformadas. A Anthropic API tem structured output nativo agora — eliminar essa classe inteira de bug + simplificar código.

## Tooling / Migração

- [ ] **Drizzle migration** (planejado pra v0.7.3) — substituir `better-sqlite3` direto + `applyMigrations` ad-hoc por `drizzle-orm` + `drizzle-kit`. Schema declarado em TS, migrations versionadas, mesma sintaxe quando virar Postgres web. Plano detalhado em `docs/_internal/web-migration-plan.md`.
- [ ] **Trocar `pdf-parse` por `pdfjs-dist`** — pdf-parse 1.1.4 é dep antiga sem updates. pdfjs-dist é oficial Mozilla, mais robusto, melhor pra PDFs com layout complexo. Refactor médio porque API muda. Avaliar antes de v1.0.

## Tech Debt

- [ ] **Paralelizar análise de múltiplos sources** — hoje `for (source) { await analyze(source) }` sequencial. Trocar por `Promise.all(sources.map(analyze))` reduz tempo do quiz quando usuário escolhe vários PDFs. Cuidado: rate limit (429) se muitos PDFs.
- [ ] **Vitest + testes do chunker, prompts e RAG** — sem testes automatizados. Pra app com pipeline de IA, refatorar é arriscado. Prioridade **alta** antes de Drizzle migration (v0.7.3) — sem testes, refator de 6 repositories é arriscado.
- [ ] **ONNX em batch ou worker thread** — embedding hoje é sequencial single-thread. Pra PDFs >1000 chunks demora minutos. Solução: usar `embed()` com batch dim do ONNX (refactor pequeno em embedding.service.ts) ou Worker Threads (refactor médio).
- [ ] **Dividir `src/types/ipc.ts`** quando passar de 250 linhas (já está em ~520). Pra `types/ipc/` com 1 arquivo por feature + index.ts re-exportando.
- [ ] **CSP em produção pra HuggingFace Hub** — primeira ingestão precisa baixar tokenizer.json. Hoje funciona porque o download roda no main process (CSP não se aplica). Revisar quando ARM64/Mac entrar.

## Features adiadas

- [ ] **RAG no chat inline do quiz** — v0.7.0 entrega chat sem RAG (contexto = pergunta + alternativas + explicação). Quando o aluno fizer perguntas tangenciais ("como isso aparece no capítulo X do livro?"), a IA não tem como olhar o material. Caminho: adicionar opção 3b — busca vetorial restrita à `source_id` que originou a pergunta do quiz. Latência sobe de ~1.5s pra ~3-4s. Avaliar baseado em uso real.
- [ ] **RAG memory (vector memory sobre conversas)** — pra conversas longas (>50 mensagens), embed cada mensagem antiga e fazer RAG sobre o histórico. Quando a query atual referenciar contexto distante, busca semântica recupera as msgs relevantes. Concorrência com sliding window: combinar (sliding window cobre recente, RAG cobre distante). Frameworks tipo Mem0, Zep. Não-prioridade.
- [ ] **Memória estruturada / agentic** — extrair fatos sobre o usuário ("Pedro estuda Sistema Toyota", "tem dificuldade com regra do produto") e persistir entre **sessões diferentes**. Conceito da feature "Memory" do ChatGPT/Claude.ai. Vai além do escopo de uma conversa. Frameworks: Letta, MemGPT, LangGraph memory. Não-prioridade — só vira útil quando o app for usado dia a dia por meses.
- [ ] **Escopo "global" no chat** — opção de criar conversa que busca em TODOS os PDFs do app, não só do tópico/matéria atual. UI: ao criar nova conversa, dropdown "buscar em: este tópico / esta matéria / todos os materiais". Schema: `scope_type = 'global'` ou similar. Ajusta `rag.service.ts` pra ignorar filtro de source quando global.
- [ ] **Memória do chat: sliding window maior + resumo automático** — hoje 20 msgs sem resumo. Próximo passo: rolling summary (resumo das mais antigas em parágrafo único). Ver também "RAG memory" acima.
- [ ] **Streaming de resposta no chat** — UX melhor (cada token aparece em vez de spinner). Requer event-based IPC (igual progresso de embeddings). v0.4.1+ se UX virar dor.
- [ ] **Modo "quick" no quiz (1 chamada em vez de 3)** — pular validação na geração. ~30% economia de tokens, qualidade um pouco menor. Adicionar como toggle "Modo rápido" no QuizSetup. Reavaliar baseado em feedback de uso.
- [ ] **Validação em modelo mais barato (Haiku 4.5)** — etapa 3 (validação) é mais simples, Haiku resolve. ~80% mais barato pra essa etapa específica. Requer mexer em `claude.service.ts` pra aceitar `model` por chamada.
- [ ] **Truncar material da análise pra economizar input tokens** — hoje manda 50k chars pro Claude na etapa 1. Reduzir pra 20-30k cobre maioria dos PDFs com ~60% economia de input. Avaliar perda de qualidade.
- [ ] **Botão "novo quiz com mesmos params"** — hoje "Gerar novo quiz" volta pro Setup vazio. Pré-popular o form com sources/count/types/theme do quiz anterior pra repetir setup com 1 clique.
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
