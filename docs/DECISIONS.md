# Architecture Decision Records — tutor.ai

Toda decisão técnica não-óbvia entra aqui no formato ADR.

**Status:** ✅ Aceita · 🚧 Proposta · ❌ Revogada (substituída por ADR-XXX)

---

## ADR-001: electron-vite v5 (não v2 nem Vite puro)
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Precisamos bundlear main + preload + renderer com HMR. O Vite puro exige config manual de 3 entries; electron-vite automatiza isso.

### Decisão
Usar `electron-vite@^5.0.0`.

### Alternativas consideradas
- **electron-vite v2.3** — descartada: peer dep conflict com Vite 6.
- **Vite puro com 3 configs** — descartada: ~3x mais código, mais bugs.
- **electron-forge / electron-builder direto** — não cobrem dev/HMR.

### Consequências
+ HMR nas 3 camadas do Electron
+ Externalize automático em v5 (não precisa do plugin)
- Pacotes ESM-only quebram (resolvido em ADR-014)
- v5 não auto-detecta entry; precisa `build.rollupOptions.input: { index }` explícito

---

## ADR-002: HashRouter (não BrowserRouter)
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
React Router 7. Em produção, o app carrega via `file://`. BrowserRouter usa History API que requer servidor configurado, quebra com `file://`.

### Decisão
`HashRouter` em todas as rotas.

### Alternativas consideradas
- **BrowserRouter + servidor estático embutido** — adiciona complexidade desnecessária.
- **MemoryRouter** — sem URL no hash, pior pra debug e back/forward.

### Consequências
+ Funciona out-of-the-box em prod
+ URL visível (ex: `#/subjects/abc`) facilita debug
- URLs feias (#/) — aceitável pra app desktop

---

## ADR-003: Tailwind v4 com configuração CSS-first
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Estilização do app. Tailwind v4 trouxe novo modelo de configuração via `@theme {}` em CSS, sem `tailwind.config.ts`.

### Decisão
Adotar Tailwind v4 com `@theme` em `src/styles/globals.css`. Sem PostCSS — usar `@tailwindcss/vite`.

### Alternativas consideradas
- **Tailwind v3 + tailwind.config.ts** — bem testado mas legacy.
- **CSS Modules + variáveis** — verbose, lento de iterar.
- **CSS-in-JS (styled-components, emotion)** — runtime overhead, complica SSR.

### Consequências
+ Config em 1 lugar (CSS), não 2 (JS + CSS)
+ Sem dependência de PostCSS
- Stack mais nova (menos exemplos online)

---

## ADR-004: `@lancedb/lancedb` (não `vectordb`)
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
ARCHITECTURE.md original mencionava `vectordb` como vector DB. Esse pacote foi renomeado upstream.

### Decisão
Usar `@lancedb/lancedb@^0.18.0`.

### Alternativas consideradas
- **vectordb** — descartada: deprecada/renomeada.
- **Chroma** — descartada: requer servidor Python.
- **Qdrant** — descartada: requer servidor.

### Consequências
+ Embedded, sem servidor
+ Performante, escrito em Rust
- API JS/TS é mais nova; algumas operações flaky em alguns casos (resolvido em ADR-018)

---

## ADR-005: `@electron/rebuild` (não `electron-rebuild`)
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Módulos nativos (better-sqlite3) precisam ser recompilados contra os headers do Electron quando mudamos versão.

### Decisão
Usar `@electron/rebuild@^3.6.0` como `postinstall` script.

### Alternativas consideradas
- **electron-rebuild** — pacote antigo, descontinuado.

### Consequências
+ Roda automaticamente após `npm install`
+ Cobre todos os nativos sem listar manualmente

---

## ADR-006: `.npmrc` para forçar build de nativos no Node 24/Windows
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
`better-sqlite3` falhava no link com `/LTCG:INCREMENTAL` (ClangCL) no Node 24 / Windows.

### Decisão
`.npmrc` com:
```
runtime=electron
target=33.2.0
disturl=https://electronjs.org/headers
msbuild_toolset=v143
```

### Alternativas consideradas
- **Downgrade Node** — quebra outros projetos do dev.
- **Pré-built do better-sqlite3** — não cobre Node 24 ainda.
- **Trocar por sqlite3 (lib)** — perf inferior, API assíncrona pesada.

### Consequências
+ Build funciona em Node 24
- Warnings cosméticos (`npm warn Unknown project config`) — inofensivos

---

## ADR-007: SQL embutido no bundle via `import schema from './schema.sql?raw'`
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Schema SQL precisa rodar na primeira inicialização do app. Como acessá-lo em prod (bundle empacotado)?

### Decisão
Usar Vite `?raw` import: `import schema from './schema.sql?raw'`. O SQL vira string embutida no bundle final.

### Alternativas consideradas
- **fs.readFileSync em runtime** — quebra em prod (path muda no .asar).
- **String literal no .ts** — perde syntax highlight de SQL.

### Consequências
+ Funciona igual em dev e prod
+ Mantém arquivo `.sql` separado com syntax highlight
- Requer `electron/types.d.ts` declarando o módulo

---

## ADR-008: IPC tipado em 3 lugares síncronos
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Toda chamada IPC tem que aparecer em 3 lugares no código: contrato, implementação preload, handler main. Erro fácil de cometer.

### Decisão
- `src/types/ipc.ts` é a fonte da verdade (interface `IpcApi`).
- `electron/preload.ts` implementa cada método tipado contra `IpcApi`.
- `electron/ipc/<area>.ipc.ts` registra `ipcMain.handle('namespace:method', ...)`.

Quando muda algo, o TS aponta os outros 2 lugares.

### Alternativas consideradas
- **tRPC ou similar** — overkill pra IPC interna.
- **String channels sem tipo** — perde toda checagem.

### Consequências
+ Refactor seguro
+ Autocomplete em tudo
- Boilerplate em 3 lugares quando adiciona método novo

---

## ADR-009: Eventos de progresso via `webContents.send` + `ipcRenderer.on`
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Operações longas (download de modelo, ingestão de PDF) precisam reportar progresso. `ipcRenderer.invoke` resolve só uma vez.

### Decisão
Pattern event-based:
- Main empurra eventos com `win.webContents.send('canal:progress', data)`.
- Preload registra `ipcRenderer.on('canal:progress', handler)` e expõe ao renderer uma função que recebe callback. Retorno é função de cleanup.

### Alternativas consideradas
- **Polling** — desperdício de IPC.
- **WebSocket** — overkill, IPC já é bidirecional.

### Consequências
+ Progresso fluido, callback simples no renderer
+ Cleanup explícito previne memory leak
- Funções não atravessam IPC; precisa do truque do listener no preload

---

## ADR-010: Schema idempotente, sem migrations na v0.x
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Toda tabela usa `CREATE TABLE IF NOT EXISTS`. Sem migrations.

### Decisão
Adiar sistema de migrations até a primeira mudança de schema acontecer.

### Alternativas consideradas
- **umzug ou similar desde o dia 1** — overhead pra adicionar features que não vão mudar schema.

### Consequências
+ Boot simples
+ Onboarding de dev mais rápido
- Quando schema mudar, vai dar pau no banco existente. Plano: `BACKLOG.md` aponta isso.

---

## ADR-011: `pdf-parse` (não `pdfjs-dist`)
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Extração de texto de PDFs uplodados.

### Decisão
`pdf-parse@^1.1`.

### Alternativas consideradas
- **pdfjs-dist (Mozilla)** — mais robusto pra layout complexo, mas pesado.
- **PDF.co (API)** — quebra "tudo local".

### Consequências
+ Maduro, simples, node-only
+ Suficiente pra PDFs acadêmicos típicos
- Sem OCR (PDFs escaneados retornam vazio) — backlog

---

## ADR-012: Chunking por parágrafo + sliding window com overlap 50 tokens
Data: 2026-04-29 · Status: ✅ Aceita

### Contexto
Quebrar texto pra embedar. Tem que preservar contexto na fronteira.

### Decisão
- Quebra primária por parágrafos (`\n\n`).
- Parágrafos longos (>500 tokens) viram sliding window com 50 tokens de overlap.
- Estimativa de tokens via `chars / 4` (sem dependência de tokenizer pesado).

### Alternativas consideradas
- **tiktoken** pra contagem precisa — adiciona dep.
- **Chunks fixos por tamanho** sem respeitar parágrafo — perde unidade semântica.

### Consequências
+ Sem dep extra
+ Parágrafos curtos viram chunks íntegros
- Aproximação de tokens é grosseira mas funciona

---

## ADR-013: Tokenizer real BERT via `@xenova/transformers`
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
A v0.1.0 tinha um tokenizer falsificado (hash de char codes). Isso produzia embeddings com formato correto (384 dims) mas semanticamente sem sentido.

### Decisão
Substituir pelo tokenizer real do BERT-base usando `@xenova/transformers` (`AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2')`).

### Alternativas consideradas
- **Manter fake até v0.4.0 (RAG)** — descartada: embeddings ruins entram no DB e precisariam reprocessar tudo depois.
- **`tokenizers-node` (HuggingFace)** — requer build nativo, menos amigável que `@xenova`.

### Consequências
+ Embeddings semanticamente válidos desde a v0.2.x
+ Cache em `userData/models/transformers-cache/` (~1MB)
- Primeira ingestão precisa de internet pra baixar o tokenizer
- Pacote é ESM-only (resolvido em ADR-014)

---

## ADR-014: Dynamic `import()` para `@xenova/transformers` em main process CJS
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
`@xenova/transformers` é publicado como ESM-only. O main process do Electron é bundleado como CommonJS. `require()` falha com `ERR_REQUIRE_ESM`.

### Decisão
- Usar `import type { ... }` pra obter tipos sem código (não vira `require`).
- Carregar o módulo em runtime com `await import('@xenova/transformers')` dentro de função async.

### Alternativas consideradas
- **Bundler convertendo ESM → CJS** — frágil, falhou em alguns casos.
- **Mudar main pra ESM** — toca em outras configs (electron-vite, package.json `"type"`).

### Consequências
+ Surgical fix, não toca em config
+ Compatível com qualquer pacote ESM-only futuro
- Carrega tokenizer lazy (primeira chamada de `embed()`) — ~500ms a mais na primeira ingestão

---

## ADR-015: Repositories pattern para CRUD
Data: 2026-04-30 · Status: ✅ Aceita

### Contexto
Como organizar queries SQL e separar de IPC handlers / services?

### Decisão
Cada entidade ganha um `<entity>.repo.ts` com:
- Tipos da entidade (camelCase)
- Tipo da row do banco (snake_case)
- Função `mapRow()` snake_case → camelCase
- Funções CRUD (`list`, `get`, `create`, `update`, `delete`)
- Validação de regras de negócio

Sem ORM. SQL puro com prepared statements.

### Alternativas consideradas
- **Drizzle ORM** — ORM mais simples mas adiciona abstração.
- **Prisma** — pesado pra app desktop com SQLite local.
- **Misturado em IPC handlers** — vira god file.

### Consequências
+ Refactor de query muda 1 arquivo
+ Testável (substitui repo por mock no service)
+ Padrão repete pra cada entidade nova
- Boilerplate de mapRow + tipos duplicados (snake/camel)

---

## ADR-016: SHA-256 do conteúdo pra dedup de arquivos
Data: 2026-05-01 · Status: ✅ Aceita

### Contexto
Usuário pode subir o mesmo PDF em múltiplos tópicos. Não duplicar no disco.

### Decisão
Calcular SHA-256 do arquivo no upload. Salvar em `userData/sources/<hash>.<ext>`.

### Alternativas consideradas
- **UUID por upload** — perde dedup.
- **MD5** — colisão é teoricamente possível.

### Consequências
+ Mesmo conteúdo = 1 arquivo no disco
+ Hash também identifica versões iguais entre tópicos (usado em ADR-018)
- Hash custa I/O extra no upload (lê o arquivo inteiro)

---

## ADR-017: `webUtils.getPathForFile` no preload pra drag-and-drop
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
Em Electron 32+, a propriedade `file.path` foi removida. Drag-and-drop precisa de outra forma de descobrir o caminho real.

### Decisão
Expor `webUtils.getPathForFile(file)` síncrono via preload (mesmo process do drag event).

### Alternativas consideradas
- **Ler conteúdo do File via FileReader e passar buffer** — funciona mas pesado.
- **Usar dialog.showOpenDialog em vez de drag-drop** — pior UX.

### Consequências
+ Drag-drop funciona nativamente
+ Arquivos grandes não são duplicados em memória
- Requer Electron 32+

---

## ADR-018: Fast-path de dedup via `content_hash` (Opção B)
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
v0.2.0 dedupava só o **arquivo no disco**. Chunks/embeddings eram recalculados toda vez que o mesmo PDF entrava em outro tópico (~80% do tempo de pipeline desperdiçado).

### Decisão
Antes de extrair/chunkar, o pipeline chama `findProcessedSourceByHash`. Se acha outra source com mesmo hash já processada, copia chunks (SQLite) e vetores (LanceDB) em vez de re-processar.

### Alternativas consideradas
- **Opção A: tabela `documents` compartilhada** (referenciada por múltiplas sources) — refactor maior, deferred to v1.x. Anotado em BACKLOG.
- **Manter sem dedup** — desperdício real de tempo do usuário.

### Consequências
+ ~95% mais rápido pra PDFs repetidos (medido com 1492 chunks)
+ Não muda contrato externo nem schema
- Storage continua duplicado (chunks/vetores em N sources se PDF está em N tópicos). Aceitável; resolvido completamente em Opção A no futuro.

---

## ADR-019: Scan + filter em JS (não `query().where()`) no LanceDB
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
Implementação inicial de `listChunkVectorsBySource` usava `table.query().where("source_id = '...'").toArray()`. Travava sem retornar nem rejeitar.

### Decisão
Scanear a tabela inteira com `table.query().toArray()` e filtrar em JS por `source_id`. Mais robusto, custo aceitável (tabela tem centenas-milhares de vetores).

### Alternativas consideradas
- **Investigar/abrir issue no LanceDB** — futuro; bug provável na lib.
- **Usar `search()` com vetor dummy + filter** — gasta computação inútil.

### Consequências
+ Funciona consistentemente
- O(N) por chamada — ruim se a tabela crescer pra milhões. Reavaliar em v1.0.

---

## ADR-020: IPC files dividido por entidade (`subjects.ipc.ts`, `topics.ipc.ts`, ...)
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
`database.ipc.ts` original concentrava handlers de subjects + topics + sources. Crescia rápido (já 180 linhas) e ia dobrar com quizzes/conversations da v0.3.0+.

### Decisão
Cada entidade tem seu próprio `<entity>.ipc.ts` com `register<Entity>Handlers()`. Pattern espelha o que já existia (`settings.ipc.ts`, `setup.ipc.ts`, `files.ipc.ts`, `embeddings.ipc.ts`).

### Alternativas consideradas
- **Manter `database.ipc.ts` god file** — vira pesadelo de manter.
- **1 arquivo por entrypoint** — ainda mais granular, mas overkill.

### Consequências
+ 1 arquivo por entidade ≤ 100 linhas
+ Fácil pra IA encontrar "onde mexer no IPC de subjects"
- 5+ arquivos em vez de 1; mais imports em main.ts

---

## ADR-021: Helpers de chunk vivem em `chunks.repo.ts` (texto + vetor unificados)
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
`lancedb.ts` continha conexão LanceDB + helpers específicos de chunks (insert, list, delete vetores). Misturava 2 níveis de abstração.

### Decisão
- `lancedb.ts` mantém só conexão (`getLanceDb`, `initChunksTable`).
- `chunks.repo.ts` ganha as operações de vetor além das de texto. Chunk é a entidade conceitual única; faz sentido viver em 1 lugar mesmo armazenado em 2 stores.

### Consequências
+ "Operações de chunk" tem 1 arquivo
+ `lancedb.ts` fica isolado pra qualquer outra tabela futura
- Repo lida com 2 stores (SQLite + LanceDB) — aceitável porque o chunk é a junção dos dois conceitualmente

---

## ADR-022: Quiz com pipeline de 3 etapas + Sonnet 4.6 + cache de análise
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
A v0.3.0 precisa gerar quizzes a partir do material do usuário. Decisões correlatas: qual modelo da Anthropic, quantas chamadas, como evitar custo desnecessário.

### Decisão
- **Modelo:** `claude-sonnet-4-6` como default fixo. Sem toggle de Opus na v0.3.0.
- **Pipeline:** 3 chamadas sequenciais, não 1. Etapas: análise (extrai conceitos) → geração (gera perguntas a partir dos conceitos) → validação (filtra ambíguas/triviais/duplicadas).
- **Cache:** resultado da análise é serializado em `sources.extracted_concepts` (coluna que já existia no schema desde v0.1.0). Quizzes futuros do mesmo material pulam a etapa 1.
- **Modo único:** só pipeline "quality" (3 etapas). Sem modo "quick" (1 chamada) na v0.3.0.

### Alternativas consideradas
- **Opus 4.7** — descartada: 5x mais caro, qualidade marginalmente melhor pra essa tarefa estruturada.
- **Haiku 4.5** — descartada: distratores ficam fracos (alternativas erradas óbvias).
- **1 chamada (PDF + "gera 10 perguntas")** — descartada: gera perguntas superficiais ou sobre o documento em si (autor, capa) em vez do conteúdo.
- **Modo "quick" como toggle** — descartado: complexidade extra sem benefício claro. Adicionar se feedback de uso pedir.
- **Sem cache** — descartado: gerar 5 quizzes do mesmo PDF custaria 5x a etapa 1.

### Consequências
+ Qualidade alta de perguntas: distratores plausíveis, mistura de dificuldades, explicações detalhadas
+ Custo controlado: ~$0.05-$0.10 por quiz de 10 perguntas no Sonnet
+ Cache reduz custo de quizzes repetidos do mesmo material em ~30%
- Pipeline demora ~30-60s (3 chamadas sequenciais) — aceitável mas não ágil
- Sem opção pro usuário escolher modelo/modo

---

## ADR-023: Sem `claude.ipc.ts` — proxy seguro só por feature
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
ARCHITECTURE.md original previa um `claude.ipc.ts` como "proxy seguro pra API". Implementando, percebi que não é necessário: o renderer nunca precisa fazer uma chamada genérica ao Claude. Sempre é por feature (gerar quiz, sugerir tema, futuro: enviar mensagem no chat).

### Decisão
- `claude.service.ts` (main process) é interno: só outros services do main usam.
- IPC pro renderer é sempre **feature-specific**: `quizzes:generate`, `quizzes:suggestThemes`, futuro `chat:sendMessage`.
- Renderer nunca tem acesso à API key nem chama Claude diretamente.

### Alternativas consideradas
- **`claude.ipc.ts` com método `complete(params)` genérico** — descartada: aumenta superfície de ataque. Renderer poderia mandar qualquer prompt; perde validação semântica por feature.
- **Expor o cliente Anthropic ao renderer via contextBridge** — descartada: API key viraria visível, e Anthropic SDK não roda no contexto isolado do renderer.

### Consequências
+ Cada feature define seu próprio contrato (quiz IPC, chat IPC futuro)
+ Validação de input específica por feature
+ Mais fácil rastrear custo por feature
- Mais boilerplate por feature nova
- Não dá pra "chamar Claude direto" do renderer pra debug; usar `inspect-db.ts` ou similar

---

## ADR-024: Pipeline tolerante a falhas + parser parcial de JSON
Data: 2026-05-02 · Status: ✅ Aceita

### Contexto
LLMs ocasionalmente:
- Retornam JSON truncado quando bate em `max_tokens`
- Retornam texto explicativo em vez de JSON ("Não consegui...")
- Geram 1 pergunta malformada no meio de N OK
- Falham em 1 source de N (PDF bagunçado)

Comportamento original: qualquer falha = aborta tudo. Frustração alta pro usuário.

### Decisão
Robustez em camadas, do mais externo pro mais interno:

1. **Per-source na análise**: se 1 PDF falha, continua com os outros. Aborta só se TODOS falharem.
2. **`max_tokens` generoso**: aumentado pra `min(700 × N + 2000, 8192)` na geração. Cobre 99% dos casos em PT.
3. **Parser parcial de array JSON** (`parseLooseJsonArrayPartial`): se JSON está truncado no meio do último objeto, recupera os anteriores completos via state machine que respeita aspas/escape.
4. **Validação por pergunta**: pergunta malformada vira `console.warn`, não erro fatal.
5. **Validação inteira opcional**: se a etapa 3 falhar de parsear, assume todas válidas em vez de abortar (validação é "filtro bonus", não bloqueante).

### Alternativas consideradas
- **Streaming** com parsing incremental — economizaria tempo + se truncar dá pra retomar. Complexidade alta; não vale pra v0.3.0.
- **Tools / structured outputs do Anthropic** — força JSON válido no nível do SDK. Requer refactor maior; deixar pra v0.4.0+.
- **Retry automático em falha de parse** — risco de loop infinito se o problema for material ruim. Melhor parar e mostrar erro claro.

### Consequências
+ Quiz raramente aborta por falha do modelo
+ Logs no terminal com primeiros 1500 chars da resposta crua quando JSON parse falha (debug)
+ Per-source isolation: 1 PDF problemático não bloqueia os outros
- Usuário pode receber menos perguntas que pediu (10 → 7) sem aviso óbvio na UI atual

---

## ADR-025: RAG com scan + ranking em JS (não `table.search().where()`)
Data: 2026-05-03 · Status: ✅ Aceita

### Contexto
Pra busca semântica do chat, precisamos achar top K chunks similares à pergunta do usuário, filtrados pelo escopo (document/topic/subject). LanceDB tem `table.search(vec).where(...).limit(K)` nativo, mas em ADR-019 já tivemos problema com `query().where()` travando em algumas operações.

### Decisão
Implementar busca via:
1. `listChunkVectorsBySources(sourceIds[])` — scan completo + filter por source_id em JS
2. Cosine distance entre vetor da query e cada vetor candidato (em JS)
3. Ordenar e pegar top K
4. Buscar conteúdo + metadados via SQLite (`getChunksByIds`)

### Alternativas consideradas
- **`table.search(vec).where("source_id IN (...)").limit(K).toArray()`** — API nativa do LanceDB. Mais eficiente pra tabelas grandes. Descartada por consistência com ADR-019 (mesma classe de bug).
- **Construir índice IVF / HNSW** — só vale pra centenas de milhares de vetores; nosso caso (centenas-milhares) não justifica.

### Consequências
+ Robusto, sem risco de travar
+ Cosine distance em JS pra 1k vetores roda em <50ms
- O(N) por chamada — vai virar gargalo se chunks passarem de ~50k. Reavaliar em v1.0+.

---

## ADR-026: Chat com escopo fixo na conversa (não na rota atual)
Data: 2026-05-03 · Status: ✅ Aceita

### Contexto
Implementação inicial passava o `scope` (do `useChatScope`, que olha a rota) como parâmetro de `sendMessage` IPC. Bug encontrado em testes manuais: usuário cria conversa no tópico A, navega pro tópico B sem fechar painel, faz nova pergunta — RAG buscava em B, quebrando coerência da conversa.

### Decisão
- Escopo é **derivado da conversa** (lido do DB) na hora de enviar mensagem.
- IPC `chat:sendMessage(conversationId, content)` não recebe scope.
- `chat.service.sendMessage` faz `getConversation(id)` e usa `conversation.scopeType + scopeId`.
- UI mostra um chip "Buscando em: [escopo]" no header da conversa pra deixar claro pro usuário onde a conversa "vive".
- A rota atual (`useChatScope`) ainda é usada pra: (1) listar conversas do escopo atual e (2) criar conversas novas com escopo da rota.

### Alternativas consideradas
- **Manter scope da rota** — quebrado por design.
- **Permitir trocar scope no meio da conversa** — possível mas confunde UX (todo histórico da conversa mistura múltiplos escopos).

### Consequências
+ Conversa mantém coerência mesmo se usuário navega pelo app
+ UI explícita sobre escopo via chip no header
- Conversa de tópico A não aparece na lista do tópico B (correto por design, mas pode confundir até o usuário se acostumar)

---

## ADR-027: Chat com sliding window de 10 mensagens, sem resumo automático
Data: 2026-05-03 · Status: ✅ Aceita

### Contexto
ARCHITECTURE.md original mencionava "últimas 10 mensagens + resumo das anteriores". Resumo automático = +1 chamada API por turno = +30% custo + complexidade.

### Decisão
v0.4.0 implementa só sliding window de 10 (5 turnos). Sem resumo. Conversas longas (raras passar de 10 turnos) perdem contexto antigo silenciosamente.

### Alternativas consideradas
- **Window maior (20-30)** — adiada; barata mas custo aumenta linearmente.
- **Resumo automático em background** — chamada extra periódica que mantém um summary atualizado. Complexidade alta pra v0.4.0.
- **Memória vetorial** — embeddings de mensagens antigas, retrieve quando relevantes. Complexo demais.

### Consequências
+ Implementação trivial (1 query SQL `LIMIT 10`)
+ Custo previsível (1 chamada por turno + 1 de embedding)
- Conversas com >10 turnos esquecem o início. Anotado em backlog como "memória do chat".

---

## ADR-028: Sem `claude.ipc.ts` (igual ADR-023, agora também pra chat)
Data: 2026-05-03 · Status: ✅ Aceita

### Contexto
Mesmo princípio do ADR-023 (sem proxy genérico de Claude pra renderer): chat tem seu próprio IPC `chat:sendMessage`, que é feature-específico. Renderer nunca chama Claude direto.

### Decisão
- `chat.service.ts` (main process) é interno
- IPC pro renderer é específico: `chat:create`, `chat:sendMessage`, `chat:listConversations`, etc.
- Renderer não tem acesso a `complete()` direto.

### Consequências
- Padrão consistente com quiz (ADR-023) e qualquer feature futura que use Claude
- Cada feature tem superfície IPC focada e validável

---

## ADR-029: Query rewriting antes do RAG (chamada extra ao Claude)
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
RAG inicial usava só a última mensagem do usuário como query. Perguntas referenciais ("resolva esse exercício", "explica isso", "anterior") confundiam a busca: a query "resolva esse exercício" tem embedding genérico, traz qualquer exercício do material em vez do que estava sendo discutido.

### Decisão
Antes do RAG, fazer chamada extra ao Claude que reescreve a pergunta usando histórico recente (4 últimas mensagens). A pergunta reescrita é autônoma — exemplo: "resolva esse exercício" + histórico sobre produtividade total → "como calcular produtividade total com input R$ 66M e output 1.4M toneladas?".

Heurísticas pra economizar API calls:
- Histórico vazio (1ª pergunta) → skip rewrite
- Query <5 chars → skip
- Query >250 chars → skip (provavelmente já é específica)

### Alternativas consideradas
- **Concatenar histórico no embedding** — naive, perde foco da pergunta atual.
- **Multi-query (gera N queries paralelas, faz busca em cada)** — mais robusto mas custo proporcional a N. Overkill pra v0.5.
- **Manter sem rewrite** — UX ruim em conversa real.

### Consequências
+ Conversação natural funciona (referências resolvidas)
+ Logs no terminal mostram "rewrote: X → Y" pra debug
- +1 chamada API por turno (~$0.001 — input ~500 tokens, output ~50)
- +1-2s latência por turno

---

## ADR-030: Page numbers via `pdf-parse` pagerender callback
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
v0.4.0 e antes guardava `page_number` como NULL em todos os chunks. RAG citava "chunk 26" em vez de "página 14" — pouco útil pro usuário que quer abrir o PDF original.

### Decisão
- `pdf-parser.ts` agora usa o callback `pagerender` do `pdf-parse` pra capturar texto por página em `pages: string[]`
- `text-chunker.ts` ganha `chunkPages(pages)` que gera chunks por página (chunks NUNCA cruzam fronteira de página)
- Cada chunk carrega `pageNumber: number | null` (1-based)
- Schema `document_chunks.page_number` agora é populado
- Prompt e UI usam página real ("página 14") quando disponível, fallback pra "chunk N" pra PDFs ingeridos antes da v0.5.

### Alternativas consideradas
- **pdfjs-dist direto** — mais controle mas refactor grande. Não vale o ganho.
- **Inferir página por offset no texto bruto** — frágil; tabelas/colunas confundem.

### Consequências
+ Citações mais úteis pro usuário
+ Trade-off: chunks que cruzariam página viram 2 chunks separados (aceitável; página é unidade lógica)
- PDFs antigos (sem reprocessar) continuam com `page_number = NULL` — UI cai em fallback

---

## ADR-031: Estrutura detectada via regex (Exercício N, Capítulo N, etc)
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
RAG baseado só em similaridade semântica não acerta perguntas posicionais ("qual o exercício 5?"). O número não tem peso pro embedding.

### Decisão
- `electron/utils/structure-detector.ts` aplica regex no início de cada chunk pra detectar labels: "Exercício N", "Capítulo N", "Seção N", "Exemplo N", "Questão N", "Problema N", "Aula N", "Unidade N" (PT-BR + EN)
- Cada chunk ganha `structuralLabel: string | null`
- Schema migration leve: ALTER TABLE `document_chunks ADD COLUMN structural_label TEXT` quando DB existente não tem
- Prompt do chat-tutor inclui label nos trechos: `(Fonte: "X.pdf", página 5, exercício 3)`
- UI mostra chip 🟣 com o label na expansão de fontes

### Alternativas consideradas
- **Filtro estrutural ANTES do embedding** — usuário pergunta "exercício 5" → busca filtrada apenas em chunks com `structural_label = "exercício 5"`. Mais preciso mas requer parser de query estrutural. Anotado em backlog.
- **NLP estruturado (extrair seções via modelo dedicado)** — overkill pra v0.5.

### Consequências
+ IA pode citar "Exercício 5 (página 8)" em vez de "chunk 26"
+ Filtro estrutural na próxima sprint usa esse campo
+ Cobertura ampla de patterns acadêmicos PT/EN
- Detector é heurístico — falsos positivos possíveis ("Exercício de respiração..."). Aceitável; o pior caso é label errado (não bloqueante).

---

## ADR-032: Schema migrations leves no boot (sem framework dedicado)
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
v0.5.0 traz a 1ª mudança de schema (adicionar `structural_label`). `CREATE TABLE IF NOT EXISTS` não atualiza colunas em tabelas existentes — DB criado em <0.5 não teria a coluna.

### Decisão
Função `applyMigrations(db)` em `connection.ts` roda no boot:
1. Lê `PRAGMA table_info(<tabela>)` pra checar quais colunas existem
2. Se faltar coluna nova, executa `ALTER TABLE ADD COLUMN`
3. Idempotente: rodar 2x não dá erro

Sem framework (umzug, knex). Quando atingir ~3 migrations, trocar.

### Alternativas consideradas
- **umzug com tabela `schema_versions`** — overkill pra 1ª migration.
- **Forçar reset (clearAll)** — péssima UX, perde dados do usuário.

### Consequências
+ DB de versões antigas atualiza automaticamente
+ Implementação trivial (~10 linhas)
- Não rastreia "qual migration foi aplicada" — basta a checagem por coluna
- Rever quando virar mais complexo

---

## ADR-033: Filtro estrutural antes do RAG semântico
Data: 2026-05-05 · Status: ✅ Aceita

### Contexto
v0.5.0 já detecta labels estruturais (`structural_label = "exercício 5"`) na ingestão. Mas no chat, "resolva o exercício 5" ainda passava pelo embedding — o vetor de "exercício 5" não é especialmente próximo do vetor do conteúdo desse exercício, então a recall caía pra K vizinhos do texto da pergunta, não do exercício.

### Decisão
Antes do RAG semântico, em `rag.service.ts`, aplicar `extractStructuralFilter(query)`:
1. Lista de regex (PT-BR + EN) detecta padrões "exerc[íi]cio N", "exemplo N", "questão N", "problema N", "capítulo N", "seção N", "unidade N", "aula N" + variantes EN
2. Se match: normaliza pra `canonical + número` (ex: "exercício 5") e consulta `listChunksByStructuralLabel(sourceIds, label)`
3. Se houver chunks com esse label: retorna direto (skip semântico + FTS)
4. Se não match ou label não existe no DB: cai no fluxo híbrido (semântico + FTS)

### Alternativas consideradas
- **Usar só semântico** — evita complexidade mas tem recall ruim em queries estruturais.
- **Sempre rodar todos (semântico + FTS + estrutural) e fundir** — RRF resolveria, mas estrutural é determinístico (match exato): faz sentido short-circuit.
- **LLM extrair filtro** — chamada extra ao Claude, custo ~10× maior, latência. Regex resolve 95% dos casos.

### Consequências
+ Recall ~100% pra queries estruturais explícitas
+ Latência menor (skip embedding + scan vetorial)
+ Determinístico, fácil de debugar
- Cobertura limitada aos padrões na regex list (extensível)
- Falha silenciosa: query "exercício 5" sem chunk com label "exercício 5" cai pro híbrido sem aviso

---

## ADR-034: Hybrid search via SQLite FTS5 + Reciprocal Rank Fusion
Data: 2026-05-05 · Status: ✅ Aceita

### Contexto
RAG só vetorial perde recall em:
- Queries com termos raros (nomes próprios, fórmulas, jargão técnico) — embeddings aprendidos diluem palavras pouco frequentes no corpus de treino do MiniLM
- Queries onde o usuário cita literalmente um termo do material (ex: "explica o teorema de Bolzano-Weierstrass")

FTS resolve isso (BM25 prioriza match léxico raro), mas FTS sozinho perde queries parafraseadas. Híbrido é o estado da arte.

### Decisão
1. **FTS5 virtual table** `document_chunks_fts` em `schema.sql`: external content (`content=document_chunks, content_rowid=rowid`) → não duplica dados, só índice invertido. Tokenizer `unicode61 remove_diacritics 1` → "produção" acha "producao".
2. **Triggers** AFTER INSERT/DELETE/UPDATE em `document_chunks` mantêm FTS sincronizado.
3. **Backfill** em `applyMigrations`: pra DBs com chunks pré-v0.6, repopula FTS via `INSERT ... SELECT` (triggers só pegam novos).
4. **Helper** `searchChunksByFts(sourceIds, query, k)` em `chunks.repo.ts`: parsea query do usuário em palavras (`\p{L}\p{N}\s+`), filtra ≥3 chars, junta com OR (`"palavra1" OR "palavra2"`), ordena por `bm25(document_chunks_fts)`.
5. **Fusão via Reciprocal Rank Fusion (RRF)** em `rag.service.ts`:
   - Roda semantic search → ranked list por similaridade
   - Roda FTS → ranked list por BM25
   - Score final: `Σ 1/(RRF_K + rank)` com `RRF_K=60`
   - Top-K dos chunks fundidos vai pro Claude

### Alternativas consideradas
- **Só semântico** — perde queries lexicais (status quo v0.5).
- **Só FTS** — perde paráfrases.
- **Concatenar e re-ranquear com Claude** — caro e lento (chamada extra).
- **Naive merge (ex: pegar top-5 de cada e dedup)** — biaseia pra resultados de uma engine; RRF é canônico (Cormack et al, SIGIR 2009).
- **Weighted fusion** (`α·sim + (1-α)·bm25`) — exige tuning de α por corpus; RRF é parameter-free e robusto.

### Consequências
+ Recall melhor em queries técnicas e paráfrases simultâneas
+ FTS5 é built-in do SQLite — sem dependência nova
+ Tokenizer unicode61 lida bem com português (acentos)
+ RRF é trivial de implementar (~15 linhas)
- Latência ligeiramente maior: agora 2 queries (vetorial + FTS) por chamada
- Backfill no boot pode ser lento em DBs com >10k chunks (medido aceitável até ~50k)
- Migration assume FTS table sempre existe (criada via `CREATE VIRTUAL TABLE IF NOT EXISTS` em schema.sql)

---

## ADR-035: Chat inline em pergunta de quiz reusa `conversations`+`messages`
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
v0.7.0 introduz chat inline em cada pergunta de quiz — aluno tira dúvidas sem sair da tela. Schema da v0.1 já tinha `quiz_questions.doubt_question` e `doubt_response` (suficiente pra 1 par pergunta/resposta), mas multi-turn é a UX que faz sentido pra estudo (1ª resposta gera 2ª dúvida).

### Decisão
Não criar tabela nova (`quiz_question_messages`). Em vez disso, **reusar a tabela `conversations` + `messages`** que já implementa multi-turn com sliding window:

1. Adicionar `'quiz_question'` ao enum `ScopeType`. Cada pergunta de quiz vira uma `conversation` (1:1) com `scope_id = quiz_question_id`.
2. Mensagens vão pra tabela `messages` que já existe — multi-turn nativo.
3. Helper `findConversationByScope(type, id)` recupera ou retorna null (criação lazy na 1ª dúvida).
4. Pipeline customizado em `chat.service.ts` (`sendQuizDoubt`): pula rewriter+RAG, injeta contexto da pergunta no system prompt.

Schema atual (`doubt_question`, `doubt_response`) fica como **legacy** — não removido pra não exigir migration, mas não populado pelo novo fluxo.

### Alternativas consideradas
- **Usar só `doubt_question`/`doubt_response` (1 par)** — fácil, mas multi-turn é a UX certa pra estudo. Aluno raramente entende com 1 troca.
- **Tabela nova `quiz_question_messages` (FK pra quiz_questions)** — semanticamente mais limpa, mas duplica infra (sliding window, persistência, optimistic UI) que já existe em `messages`.
- **Conversation `scope_type='document'` apontando pro source da pergunta** — não casa: 1 source tem N perguntas, viraria conversa única; queríamos 1 conv por pergunta.

### Consequências
+ Multi-turn de graça via tabela existente
+ Reuso direto de `addMessage`, `getRecentMessages`, sliding window, ChatMessage UI
+ Schema migration mínima (só TypeScript enum — SQLite não valida `scope_type`)
+ Coluna `context_chunks` em messages fica null pra `quiz_question` (sem RAG)
- Tabela `conversations` agora cobre 2 casos de uso (chat global + quiz inline). Trade-off aceitável dado que ambos são "diálogos com IA".
- `doubt_question`/`doubt_response` viram dead columns. Removível em migration futura.

---

## ADR-036: Quiz inline sem RAG — contexto via system prompt
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
Chat inline de quiz precisa do contexto da pergunta (enunciado + alternativas + correta + explicação + escolha do aluno) pra IA responder bem. Duas opções: (a) injetar via user prompt da 1ª mensagem; (b) injetar via system prompt em toda chamada.

### Decisão
**System prompt com contexto injetado**. Em toda chamada ao Claude, `buildQuizTutorSystemPrompt(ctx)` retorna prompt base + bloco com pergunta+alternativas+explicação+estado do aluno.

Pipeline de `sendQuizDoubt` em `chat.service.ts`:
1. Lê `quiz_questions` pelo id (pergunta + alternativas + explicação + selectedIndex)
2. Cria/recupera conversation `scope_type='quiz_question'`
3. Persiste user message
4. Carrega histórico (sliding window 20)
5. Monta system prompt com contexto da pergunta
6. Chama Claude — SEM RAG, SEM rewriter
7. Persiste resposta

### Alternativas consideradas
- **Contexto na 1ª user message** — funciona até a 1ª msg sair do sliding window. Em conversa longa (>20 turnos), IA perde contexto da pergunta.
- **RAG (busca chunks na source da pergunta)** — adicionaria ~1.5-2s de latência por turno. Explicação oficial já carrega o material relevante. Adiado pra v0.7+ (BACKLOG).
- **Custom retriever que injeta só o `quiz_questions` row** — over-engineering pra 1 caso de uso.

### Consequências
+ Contexto da pergunta sobrevive ao sliding window (invariante)
+ System prompt cresce ~800-1500 tokens — aceitável; cacheable se Claude API fizer prompt caching no futuro
+ Pipeline mais simples que chat global (1 chamada Claude vs 2)
- Sem RAG: dúvidas tangenciais ("isso aparece em outras aulas?") são respondidas com "use o chat global". Trade-off de simplicidade.

---

## ADR-037: Sliding window 10 → 20 mensagens (chat global e inline)
Data: 2026-05-04 · Status: ✅ Aceita

### Contexto
`HISTORY_WINDOW_SIZE = 10` (5 turnos) era suficiente pro chat global na v0.4. Com chat inline em quiz (v0.7), conversas tendem a ser mais focadas e mais longas — aluno faz várias perguntas em sequência sobre o mesmo assunto.

### Decisão
Aumentar pra `20` mensagens (10 turnos). Aplica nos dois fluxos (chat global e inline).

### Consequências
+ Cobre conversas mais longas sem perder contexto
+ ~2× custo de input por chamada (~2-5k tokens histórico em chat global; ~1-3k em quiz inline) — aceitável
- Quando virar dor (>20 mensagens regulares), backlog tem entry pra rolling summary / RAG memory

---

## ADR-038: Domínio plataforma-agnóstico via dependency injection
Data: 2026-05-05 · Status: ✅ Aceita

### Contexto
Decisão estratégica de eventualmente migrar o tutor.ai pra web (Next.js + Supabase). Audit em v0.7.1 revelou 4 arquivos do domínio (`utils/crypto.ts`, `services/embedding.service.ts`, `database/connection.ts`, `database/lancedb.ts`) importando `app`/`safeStorage` de `'electron'` — quebrando a regra "services e repositories ficam livres de Electron". Isso impede reuso direto do código em Next.js.

### Decisão
Aplicar **dependency injection**:
1. Services e repositories nunca importam `'electron'`. Recebem dependências (`userDataPath: string`, `SecretStorage`) via funções `configure*()` chamadas no boot.
2. **Composition root**: `electron/main.ts` é o ÚNICO lugar que conhece tanto Electron quanto domínio. Dentro de `app.whenReady()`:
   ```ts
   userDataPath = app.getPath('userData');
   secretStorage = new ElectronSafeStorage();
   configureDatabasePath(userDataPath);
   configureLanceDbPath(userDataPath);
   configureEmbeddingService(userDataPath);
   configureClaudeService(secretStorage, userDataPath);
   ```
3. **Adapter pattern** pro `safeStorage`: nova interface `SecretStorage { isAvailable, encrypt, decrypt }` em `utils/crypto.ts`. Implementação concreta `ElectronSafeStorage` em `electron/adapters/electron-secret-storage.ts` — único arquivo fora de `main.ts`/`preload.ts`/`ipc/` permitido importar de `'electron'`.

### Alternativas consideradas
- **Manter como está e refazer só na branch web** — adia o trabalho mas exige mexer em arquivos críticos quando estiver fazendo migração de plataforma simultaneamente. Risco maior.
- **Globals/singletons importando direto** — funciona local mas continua impossível reusar em Next.js.
- **Service locator** — overkill pro tamanho do projeto.

### Consequências
+ `grep -r "from 'electron'" electron/services electron/utils electron/database` retorna **zero matches**
+ Quando começar `web/` branch: services + repositories copiam direto, só troca implementação dos `configure*()`
+ Composition root explícito = mais fácil de entender ordem de bootstrap
+ Adapter pattern testável (mock `SecretStorage` em testes futuros)
- Sutil: services agora exigem `configure*()` antes do primeiro uso. Erro claro se faltar (lança `Error('não configurado')`)
- 1 arquivo novo (`adapters/electron-secret-storage.ts`) e ~6 funções `configure*()` novas

---

## ADR-039: Zod pra validação de IPC
Data: 2026-05-05 · Status: ✅ Aceita

### Contexto
Os 37 IPC handlers em `electron/ipc/*.ts` validavam input do renderer manualmente: `typeof x !== 'string'`, `Array.isArray()`, `Number.isInteger() && x >= 3 && x <= 30`, etc. Acumulavam ~200 linhas de validação boilerplate. Pior pra `quizzes:generate` (45 linhas só de validação manual).

Em web (futura migração), API recebe input do mundo (não do próprio renderer) — validação manual escala mal.

### Decisão
Adotar **Zod** (`zod@4`):
1. Schemas reusáveis em `electron/ipc/schemas.ts` (`IdSchema`, `NonEmptyStringSchema`, `NonEmptyStringArraySchema`, `ChatScopeSchema`).
2. Helper `parseInput(schema, value)` que faz `safeParse` + lança Error com mensagens concatenadas das `issues`.
3. Cada handler define schemas locais quando precisar (`GenerateQuizSchema`, `CreateSubjectSchema`, etc.) e chama `parseInput`.
4. Tipos inferidos automaticamente via `z.infer<typeof Schema>`.
5. Removido `electron/utils/type-guards.ts` (`isObject` virou desnecessário).

### Alternativas consideradas
- **Manter validação manual** — rápido mas não escala; classes inteiras de bug em web.
- **Valibot** — menor (50% bundle de Zod) mas Zod é padrão de facto no ecossistema TS, tem mais integrações (tRPC, drizzle-zod, react-hook-form). Pesa pouco no main process.
- **Yup** — sintaxe mais antiga, type inference pior.
- **TypeBox / ArkType** — mais performance mas DX inferior.

### Consequências
+ ~200 linhas de validação manual → ~80 linhas de schemas
+ Mensagens de erro consistentes (`<path>: <message>; <path>: <message>`)
+ Tipos inferidos automaticamente — zero duplicação entre runtime e compile time
+ Sintaxe idêntica quando virar API web (Server Actions, tRPC, Hono — todos usam Zod direto)
+ Compose: `ChatScopeSchema.extend({ title: z.string().nullable() })`
- Bundle size: +12KB minified (aceitável; main process)
- Aprendizado pra contributor novo, mas Zod é mainstream

---

<!--

Para adicionar uma nova ADR:
1. Próximo número (ADR-040)
2. Status começa como 🚧 Proposta enquanto rola decisão
3. Vira ✅ Aceita quando implementa
4. Se for revogada depois, marca ❌ Revogada e linka pra ADR substituta

-->
