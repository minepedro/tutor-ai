# Backlog — tutor.ai

Lugar único pra "o que falta fazer" que não está no roadmap atual ([TODO.md](TODO.md)).

**Regra:** item resolvido **sai daqui** (vai pra commit + CHANGELOG). Não fica `[x] feito`.

---

## 🔥 Próxima sprint (alta prioridade)

Itens priorizados — atacar antes de v0.6.0:

- [ ] **Filtro estrutural no RAG** — quando query menciona "exercício 5" / "capítulo 3", aplicar filtro `structural_label = X` ANTES (ou em paralelo) à busca semântica. v0.5.0 detectou e indexou os labels; agora falta usar pra filtrar. Implementação: regex no rewriter pra extrair label da query → passa como predicado SQL no `getChunksByIds`. Resolve definitivamente "exercício 5" → traz só o exercício 5.

- [ ] **Full-text search complementando vetorial** — SQLite tem FTS5 builtin. Indexar `content` dos chunks. Na busca: paralelo (vetorial + FTS), merge dos resultados com pesos. Resolve "cite palavra rara" (FTS pega substring) sem perder semântica (vetor capta sinônimos).

- [ ] **OCR pra PDFs escaneados** — integrar `tesseract.js` (~30MB binário) quando `extractPdfText` retornar < 300 chars. Idealmente OCR só nos primeiros chars pra confirmar que é imagem antes de processar tudo. Suporte multilíngue (PT-BR + EN) na config.

## 🚀 Roadmap das próximas grandes features

Pensadas em sessão 2026-05-04. Estimativas e propostas de UX detalhadas.

### v0.7.0 — Chat inline no quiz

Permitir o aluno tirar dúvidas sobre cada pergunta do quiz sem sair da tela.

**Estado:** schema **já suporta** (`quiz_questions` tem `doubt_question` e `doubt_response` desde v0.1). Falta só backend handler + UI.

**UX proposta:**
- Cada `QuizCard` ganha um botão contextual baseado no estado:
  - **Antes de responder:** `💡 Pedir dica` — IA dá pista sócratica sem entregar a resposta
  - **Após responder certo:** `🤔 Aprofundar` — explicação extra, conexões, casos similares
  - **Após responder errado:** `📚 Entender o erro` — diálogo guiado com perguntas que ajudam o aluno a chegar na resposta sozinho
- Click abre mini-chat dentro do card (ou drawer pequeno lateral)
- Histórico salvo na pergunta → ao voltar, vê dúvidas anteriores
- Multi-turn (várias trocas) → schema atual aceita 1 par; refactor leve pra criar tabela `quiz_question_messages` muitos-pra-1

**Contexto que vai pro Claude:** pergunta + 4 opções + correta + explicação + (se respondeu) escolha + última dúvida + nova pergunta.

**Custo estimado:** 1 sessão. Backend: novo handler `quizzes:askDoubt`. UI: extensão do QuizCard.

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

## Tech Debt

- [ ] **Paralelizar análise de múltiplos sources** — hoje `for (source) { await analyze(source) }` sequencial. Trocar por `Promise.all(sources.map(analyze))` reduz tempo do quiz quando usuário escolhe vários PDFs. Cuidado: rate limit (429) se muitos PDFs.
- [ ] **Vitest + testes do chunker e ingestion service** — sem testes automatizados. Pra app com pipeline de IA, refatorar é arriscado. Prioridade: **medium**, antes da v0.4.0 (chat com RAG).
- [ ] **Sistema de migrations** — schema é idempotente hoje (`CREATE TABLE IF NOT EXISTS`), mas a primeira mudança de coluna existente vai dar pau. Plano: `umzug` ou impl manual quando a primeira mudança aparecer.
- [ ] **ONNX em batch ou worker thread** — embedding hoje é sequencial single-thread. Pra PDFs >1000 chunks demora minutos. Solução: usar `embed()` com batch dim do ONNX (refactor pequeno em embedding.service.ts) ou Worker Threads (refactor médio).
- [ ] **Dividir `src/types/ipc.ts`** quando passar de 250 linhas. Pra `types/ipc/` com 1 arquivo por feature + index.ts re-exportando.
- [ ] **CSP em produção pra HuggingFace Hub** — primeira ingestão precisa baixar tokenizer.json. Hoje funciona porque o download roda no main process (CSP não se aplica). Revisar quando ARM64/Mac entrar.

## Features adiadas

- [ ] **Escopo "global" no chat** — opção de criar conversa que busca em TODOS os PDFs do app, não só do tópico/matéria atual. UI: ao criar nova conversa, dropdown "buscar em: este tópico / esta matéria / todos os materiais". Schema: `scope_type = 'global'` ou similar. Ajusta `rag.service.ts` pra ignorar filtro de source quando global.
- [ ] **Memória do chat: sliding window maior + resumo automático** — hoje 10 msgs sem resumo. v0.4.1+: aumentar pra 20 e adicionar resumo das mais antigas em parágrafo único. Ou memória vetorial (embeddings de mensagens antigas).
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
