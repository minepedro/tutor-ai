# tutor.ai — Contexto do Projeto

## Estado Atual
Versão em desenvolvimento: **v0.1.0 (Fundação)** — em verificação manual (Fase H).
Última sessão: 2026-04-29

**Versionamento:** o remote `https://github.com/minepedro/tutor-ai.git` existe, mas só tem o commit inicial de docs (`99c3ca2 docs: add architecture and roadmap`). Todo o código da v0.1.0 está **untracked localmente** — nada foi commitado nem pushado ainda. Os commits convencionais por fase serão feitos quando a Fase H passar.

## O que já está implementado

**Configuração (Fase A)**
- [package.json](package.json), [.npmrc](.npmrc), [.gitignore](.gitignore), [.env.example](.env.example)
- [tsconfig.json](tsconfig.json) (raiz) com project references → [tsconfig.node.json](tsconfig.node.json), [tsconfig.web.json](tsconfig.web.json)
- [electron.vite.config.ts](electron.vite.config.ts) — entries main/preload/renderer
- [src/styles/globals.css](src/styles/globals.css) — Tailwind v4 com `@theme` (dark theme)
- [index.html](index.html), [src/main.tsx](src/main.tsx)

**Electron + IPC tipado (Fase B)**
- [src/types/ipc.ts](src/types/ipc.ts) — fonte da verdade dos contratos IPC + `declare global { Window.api }`
- [electron/preload.ts](electron/preload.ts) — `contextBridge` tipado, padrão event-based para `setup.onProgress`
- [electron/main.ts](electron/main.ts) — janela com `contextIsolation`, `sandbox`, CSP rígida
- [electron/types.d.ts](electron/types.d.ts) — declaração de `?raw` import

**Banco de dados (Fase C)**
- [electron/database/schema.sql](electron/database/schema.sql) — 12 tabelas com `CREATE TABLE IF NOT EXISTS`
- [electron/database/connection.ts](electron/database/connection.ts) — singleton `getDb()`, WAL, foreign keys, schema embutido via `?raw`

**Settings + safeStorage (Fase D)**
- [electron/utils/crypto.ts](electron/utils/crypto.ts) — wrappers com fallback (`os-backed` / `plaintext-fallback` / `unavailable`)
- [electron/ipc/settings.ipc.ts](electron/ipc/settings.ipc.ts) — `saveApiKey`, `hasApiKey`, `loadApiKey`, `getEncryptionStatus`, `clearAll`

**Design system + layout (Fase E)**
- [src/lib/constants.ts](src/lib/constants.ts) — `ROUTES` etc.
- [src/components/ui/](src/components/ui/) — Button, Card, Input, Modal, Progress
- [src/components/layout/](src/components/layout/) — AppLayout, Sidebar, Header

**Hooks + páginas (Fase F)**
- [src/hooks/useIPC.ts](src/hooks/useIPC.ts) — wrapper tipado para `window.api`
- [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx) — input de API key + validação `sk-ant-`
- [src/pages/Home.tsx](src/pages/Home.tsx) — placeholder
- [src/pages/Settings.tsx](src/pages/Settings.tsx) — trocar chave, status de encriptação, "Limpar tudo" com Modal
- [src/App.tsx](src/App.tsx) — `HashRouter` + route guards baseados em `hasKey`

**ONNX + LanceDB (Fase G)**
- [scripts/setup-models.ts](scripts/setup-models.ts) — baixa `all-MiniLM-L6-v2` da HuggingFace
- [electron/services/embedding.service.ts](electron/services/embedding.service.ts) — singleton ONNX, `embed()`, mean pooling
- [electron/database/lancedb.ts](electron/database/lancedb.ts) — `getLanceDb()`, `initChunksTable()` (vetor 384-dim)
- [electron/ipc/setup.ipc.ts](electron/ipc/setup.ipc.ts) — `downloadModel`, `isModelReady`, progresso via `webContents.send`
- [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx) — fluxo completo: salvar chave → checar `isModelReady` → baixar com `<Progress />` → navegar. State machine `'form' | 'saving' | 'downloading'`. `useEffect` registra subscrição de progresso com cleanup.

## Decisões Técnicas

| Decisão | Por quê |
|--|--|
| **`electron-vite@^5`** (não 2.x) | v2 conflita com Vite 6 (peer deps). v5 unifica main/preload/renderer com HMR. |
| **`HashRouter`** (não BrowserRouter) | Compatível com `file://` em produção do Electron. BrowserRouter quebraria. |
| **Tailwind v4 (CSS-first)** | Sem `tailwind.config.ts` — config via `@import 'tailwindcss'` + `@theme {}`. Sem PostCSS — usa `@tailwindcss/vite`. |
| **ONNX no MVP da v0.1.0** | Embeddings locais desde o dia 1 (em vez de empurrar para v0.2.0). |
| **`@lancedb/lancedb`** (não `vectordb`) | `vectordb` foi renomeado. ARCHITECTURE.md está desatualizado. |
| **`@electron/rebuild`** (não `electron-rebuild`) | Pacote antigo descontinuado. Roda como `postinstall`. |
| **`.npmrc` para prebuilds** | Necessário para compilar `better-sqlite3` no Node 24 + Windows. Força `runtime=electron`, `target=33.2.0`, `disturl=https://electronjs.org/headers`, `msbuild_toolset=v143`. |
| **SQL via `?raw` import** | Vite embute o `.sql` como string no bundle — não precisa copiar arquivo em runtime. |
| **IPC tipado em 3 lugares sincronizados** | `src/types/ipc.ts` (contrato) → `electron/preload.ts` (impl) → `electron/ipc/*.ipc.ts` (handlers). TS aponta tudo que falta. |
| **Eventos de progresso via `webContents.send`** | Funções não serializam por IPC. Padrão: main empurra, preload faz `ipcRenderer.on()` e expõe subscrição com cleanup. |
| **CSP `connect-src 'self' https://api.anthropic.com`** | Única chamada externa permitida. Em dev libera `ws://localhost:*` para HMR. |
| **Schema idempotente** | Sem migrations na v0.1.0 — `CREATE TABLE IF NOT EXISTS`. Migrations entram quando schema mudar (v0.2.0+). |
| **DevTools `mode: 'detach'`** | Janela separada, mais espaço para o app. |

## Problemas Resolvidos

1. **`electron-vite@2.3.0` peer dep conflict com Vite 6** → subir para `electron-vite@^5.0.0`.

2. **`electron-rebuild` not found no npm** → o pacote foi descontinuado. Trocar por `@electron/rebuild@^3.6.0`.

3. **`better-sqlite3` falha no Node 24 / Windows com `/LTCG:INCREMENTAL` (ClangCL)** → criar `.npmrc` forçando target Electron + toolset MSVC v143. Os warnings `npm warn Unknown project config "runtime"` são cosméticos — `prebuild-install`/node-gyp leem o arquivo, npm em si não.

4. **electron-vite: `No electron app entry file found: out/main/index.js`** → estava usando `build.lib.entry` que nomeava o output `main.js`. Trocar por `build.rollupOptions.input: { index: resolve(...) }`.

5. **electron-vite v5: `An entry point is required`** → v5 não auto-detecta entry como v2. Declarar explicitamente em `rollupOptions.input`.

6. **`externalizeDepsPlugin` deprecated em electron-vite v5** → remover do config; agora é automático.

7. **Callback de progresso não serializa por IPC** → `ipcRenderer.invoke()` não aceita função como argumento (JSON não serializa código). Usar `webContents.send('setup:progress', data)` no main + `ipcRenderer.on()` no preload + função que retorna cleanup.

8. **Onboarding não navegava para Home após salvar a chave** → `App.tsx` lia `hasApiKey()` uma vez no mount; depois do `navigate()` o guard ainda via `hasKey === false` e redirecionava de volta. Fix: passar `onComplete: () => setHasKey(true)` como prop e chamar antes do `navigate()`.

9. **`noUncheckedIndexedAccess` quebrava `meanPool`** → `result[j] += x` era inválido porque TS tipa o índice como `number | undefined`. Fix: `result[j] = (result[j] ?? 0) + (data[...] ?? 0)`. O `?? 0` é só pro typechecker — Float32Array é zero-initialized.

10. **`NodeJS.Platform` não existia no renderer** → o tsconfig do renderer não carrega `@types/node` (e não deveria — não usa Node). Fix: definir `type Platform` literal localmente em [src/types/ipc.ts](src/types/ipc.ts) com a união de strings que `process.platform` retorna.

## Próximos Passos

**Fase H — Verificação manual (em andamento)**
- [x] `npm run dev` abre janela sem erros
- [x] Onboarding aceita API key e navega para Home
- [x] `npm run typecheck` passa sem erros
- [ ] Persistência: fechar/reabrir app deve pular onboarding
- [ ] Onboarding com download ONNX: API key + barra de progresso até 100% + navega
- [ ] Modelo: `%APPDATA%/tutor-ai/models/all-MiniLM-L6-v2.onnx` existe (~30 MB)
- [ ] DB: abrir `%APPDATA%/tutor-ai/database.db` no DB Browser → confirmar 12 tabelas
- [ ] LanceDB: confirmar `%APPDATA%/tutor-ai/embeddings/` criado
- [ ] Settings: trocar chave + "Limpar tudo" com modal de confirmação
- [ ] DevTools console: sem erros de CSP nem warnings React
- [ ] Tema: bg `#08080d`, accent `#7c5cfc`, fontes Outfit + JetBrains Mono OK

**Commit da v0.1.0**
Quando a Fase H passar, fazer commits convencionais por fase (mais fácil reverter):
- `chore(setup): configs base (Fase A)`
- `feat(electron): main + preload + IPC base (Fase B)`
- `feat(db): schema + connection (Fase C)`
- `feat(ipc): settings + safeStorage (Fase D)`
- `feat(ui): design system + layout (Fase E)`
- `feat(pages): onboarding + home + settings (Fase F)`
- `feat(embeddings): ONNX + LanceDB + setup-models (Fase G)`

Depois `git push origin main` (perguntar antes — primeira vez subindo código real).

**Próximas versões** (ver [docs/TODO.md](docs/TODO.md))
- **v0.2.0** — CRUD de matérias/tópicos, upload de PDF, extração de texto, chunking, geração de embeddings
- **v0.3.0** — geração de quiz via Anthropic API, chat com RAG
- **v0.4.0+** — flashcards (SRS), exercícios, exportação

## Convenções do Projeto
- TypeScript estrito, sem `any`
- Sem ORM, queries SQL diretas (better-sqlite3)
- IPC tipado via contextBridge
- Commits convencionais (feat:, fix:, etc)
- Dark theme padrão
- Comentários e UI em português; identificadores em inglês

## Notas para o Claude Code
- O dev não é familiar com TypeScript, explicar conceitos avançados quando aparecerem (`interface` vs `type`, generics, `declare global`, `keyof`, `as const`)
- Perguntar antes de decisões fora do ARCHITECTURE.md
- Sempre rodar `npm run dev` para validar antes de encerrar
- Nunca rodar `git push` ou `gh pr create` sem permissão explícita
