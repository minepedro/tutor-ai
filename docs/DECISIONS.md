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

<!--

Para adicionar uma nova ADR:
1. Próximo número (ADR-022)
2. Status começa como 🚧 Proposta enquanto rola decisão
3. Vira ✅ Aceita quando implementa
4. Se for revogada depois, marca ❌ Revogada e linka pra ADR substituta

-->
