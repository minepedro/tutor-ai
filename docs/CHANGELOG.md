# Changelog — tutor.ai

Releases em ordem reversa.

---

## v0.9.0 (2026-05-05) — Pipeline V2 Track 1: clustering semântico + cobertura uniforme

Resolve dor reportada: "13 PDFs com 10 questões, alguns PDFs ficavam sem nenhuma pergunta". Primeiro de 3 tracks da v0.9 — entrega cobertura uniforme garantida via clustering. Tracks 2 (UI Recomendado) e 3 (texto livre + batching) seguem em v0.9.1/v0.9.2.

### Adicionado
- **Clustering semântico** em `electron/services/clustering.service.ts`. K-means simples sobre embeddings ONNX locais (384-dim, gratuito). K default = `ceil(sqrt(n_concepts))` com floor 3 / ceil 12. Inicialização K-means++. Distância cosine. ~150 linhas, sem dependência externa.
- **Etapa 1.5 (Clustering)** no pipeline de quiz: depois da análise, conceitos viram clusters. Reusa `embed()` do `embedding.service.ts`.
- **Distribuição uniforme garantida**: cada cluster ganha quota fixa de perguntas. `quotaPerCluster = ceil(count / nClusters)`. Resto distribuído entre clusters de maior importância.
- **Shuffle de clusters** antes de mandar pro prompt → elimina bias de ordem residual (modelo tendia a focar nos primeiros).
- **Distratores melhorados**: prompt da etapa 2 agora pede explicitamente "misconceptions plausíveis" em vez de "erros genéricos". Baseado em papers (arXiv 2404.02124, arXiv 2307.16338) que documentam +8% de aprovação por professores.

### Mudado
- `quiz-generator.service.ts`: pipeline ganha etapa de clustering entre análise e geração. Progress callback novo no estágio 33% ("Agrupando N conceitos em temas…").
- `prompts/quiz-generation.ts`: aceita `clusters` em vez de lista flat de conceitos. User prompt formata cada cluster como bloco rotulado `[TEMA N]` com quota sugerida visível ao modelo. System prompt instrui cobertura uniforme + misconceptions.
- `GenerationParams.concepts: ExtractedConcept[]` → `GenerationParams.clusters: ConceptCluster[]`.

### Sem regressão
- Pipelines com 1 só PDF e poucos conceitos pulam clustering (1 cluster com tudo). Comportamento idêntico ao v0.8.x.
- Cache `extracted_concepts` mantido — clusterização é computada on-demand sobre conceitos cacheados.
- Tempo total: ~+100ms (clustering 200 conceitos). Imperceptível.

### Referências externas (pesquisa pra v0.9.0)
- "Beyond prompt and pray" (47billion blog) — pattern de produção SOTA: chunk + cluster + quota
- arXiv 2404.02124 — distratores +8% revelando resposta correta
- arXiv 2307.16338 — predictive prompting com exemplos de banco
- arXiv 2508.20567 (KCS) — sampling diversificado por cluster atinge 91-93% do ground truth

### Próximos
- **v0.9.1 (Track 2)**: modo "🤖 Recomendado" como default. Card mostra "12 questões cobrindo Derivadas (4), Integrais (3)..."
- **v0.9.2 (Track 3)**: campo "💭 O que você quer estudar?" + multi-batch generation pra >8 perguntas

Ver [ADR-043](DECISIONS.md#adr-043).

---

## v0.8.6 (2026-05-05) — Fix: barra de progresso voltava + travava em N PDFs

Correção de 2 bugs reportados após v0.8.5 em geração de quiz com **muitos PDFs** (13 sources sem cache):

### Corrigido
- **Barra "voltava" pra valor menor entre interpolações.** O hook `useSmoothProgress` fazia `setDisplayPct(realPct)` no snap mas isso podia regredir o display interpolado se React strict mode (dev) rodasse o effect 2× ou um re-render disparasse com mesmo valor. Agora usa `setDisplayPct((prev) => Math.max(prev, realPct))` — barra **nunca volta**.
- **Barra travava em ~28% por minutos** quando havia muitos PDFs sem cache. Ceiling do estágio 1 estava calibrado pra 1 source (~12s); com 13 sources paralelos a etapa 1 pode demorar 30-60s e a barra atingia o ceiling muito antes do backend mandar `30%`.

### Mudado
- **Backend reporta progresso GRANULAR** durante análise paralela: cada source que completa (cache hit OU análise nova) chama `onProgress` com pct proporcional entre 5% e 28%. Pra 13 PDFs: 13 updates intermediários em vez de só 1 ao final. Status mostra "Analisando materiais (3/13)…" em vez de ficar parado em "Analisando material…".
- Hook `useSmoothProgress` ajustado pra também aceitar valores intermediários no range de cada estágio (não só os `fromPct` exatos).

### Sem mudança
- Tempo total de geração idêntico — mudança puramente de feedback visual.

---

## v0.8.5 (2026-05-05) — Barra de progresso do quiz com interpolação suave

### Corrigido
- **Barra do quiz parecia travar entre estágios.** Backend reportava progresso em saltos discretos (5% → 30% → 35% → 75% → 100%); a barra ficava parada 10-20s entre cada salto. Sensação de "app travou" mesmo com pipeline rodando.

### Adicionado
- **`useSmoothProgress(realPct)` hook** em `src/hooks/useSmoothProgress.ts`: entre cada checkpoint real recebido do backend, interpola visualmente em direção ao próximo ceiling estimado com curva ease-out (rápido no início, desacelera). **Nunca ultrapassa o ceiling** antes do backend mandar o update real — evita "voltar" se o pipeline for mais rápido que o esperado.
- Estágios calibrados pelo pipeline atual (v0.8.4):
  - 5% → ceiling 28% em ~12s (análise)
  - 35% → ceiling 70% em ~18s (geração — etapa mais longa)
  - 75% → ceiling 95% em ~6s (validação Haiku)
- Mostra também **% numérico** ao lado do status pra reforçar a sensação de progresso.

### Integrado em
- `QuizSetup.tsx`: overlay de geração agora usa `smoothPct` em vez do `progress.pct` cru.

### Não muda
- Tempo total de geração: idêntico (interpolação é puramente visual).
- Backend continua reportando os mesmos pontos discretos.
- Pode ser reusado em outros progressos longos no futuro (ingestão, etc).

---

## v0.8.4 (2026-05-05) — Quiz mais rápido (Haiku validação + análise paralela)

Resolve dor reportada de "geração do quiz demora bastante". Sem mudança de qualidade do output — só pipeline mais eficiente.

### Mudado
- **Etapa 3 (validação) usa Haiku 4.5** em vez de Sonnet 4.6. Validação é tarefa binária com critérios objetivos — Haiku dá conta. Custo nessa etapa: ~80% mais barato. Latência: ~3× mais rápido. Ver [ADR-042](DECISIONS.md#adr-042).
- **Etapa 1 (análise) PARALELIZADA**: antes era `for (source) { await analyze(source) }` sequencial; agora `await Promise.all(sources.map(analyze))`. Cache hits resolvem instantâneo; sem-cache disparam em paralelo. Anthropic permite ~50 req/min — bem acima do que disparamos (~5-10 paralelas tipicamente).
- **`claude.service.ts:complete()` aceita `model` opcional**. Default permanece Sonnet 4.6 (ADR-022). `HAIKU_MODEL` exportado pra callers usarem. Mantém ADR-022 mas adiciona flexibilidade.

### Tempo estimado de geração

| Cenário | Antes | Depois |
|---|---|---|
| 1 source sem cache | ~30s | ~25s (-15%) |
| 3 sources sem cache | ~60s | ~30s (**-50%**) |
| 5 sources sem cache | ~90s | ~35s (**-60%**) |
| Source com cache (qualquer N) | ~20s | ~17s (-15% só do Haiku na validação) |

### Sem regressão
- Output do quiz idêntico em qualidade — Haiku validando perguntas Sonnet é diferente de Haiku gerando perguntas (que daria distratores ruins).
- Robustez: se 1 source falha, outras continuam (try/catch individual em cada Promise).
- Cache de análise (`extracted_concepts`) continua igual; segundo quiz da mesma source ainda é instantâneo na etapa 1.

---

## v0.8.3 (2026-05-05) — Dropdown de escopo no chat fullscreen

Fecha o ciclo do chat fullscreen — agora `/chat` cobre 3 dos 4 escopos (Global/Matéria/Tópico). Drawer flutuante 💬 ainda existe pra "chat dentro do tópico atual" sem mudar de rota; pode ser deprecated em release futura quando outras features parem de depender dele.

### Adicionado
- **`ScopeSelector` component** em `src/components/chat/ScopeSelector.tsx`: dropdown único com lista aninhada de Global → Matérias → Tópicos. Click fora fecha. Itens da matéria também são clicáveis (pra escolher matéria inteira). Funciona como label + estado controlado.
- **Filtro de escopo no `/chat`**: header da coluna esquerda ganha "Buscar em [escopo]" com seletor. Trocar de escopo:
  - Re-busca lista de conversas filtrada
  - Deseleciona a conversa atual (não pertence ao novo escopo)
  - Define escopo de novas conversas criadas a seguir
- **Carregamento eager** de subjects + tópicos no mount da ChatPage (1 query subjects + N queries topics em paralelo via `Promise.all`). Necessário pra alimentar o dropdown sem lazy loading que atrapalharia a UX.

### Mudado
- ChatPage: escopo virou state em vez de constante. Default ainda é `global`.
- Empty state da coluna direita adapta texto baseado no escopo selecionado.

### Sem mudança
- Conversas existentes continuam fixas no escopo em que foram criadas (já era assim — backend deriva escopo da conversa). Trocar escopo só filtra a lista; conversas antigas de outros escopos ficam invisíveis enquanto outro escopo está ativo (mas voltam quando você seleciona o escopo delas).

---

## v0.8.2 (2026-05-05) — Detector de PDF imagem (warning na ingestão)

Resolve a confusão reportada na sessão de testes (PDF "5S" tinha quase tudo em imagem; chat respondia "não encontrei isso no material" sem o aluno entender por quê).

### Adicionado
- **Heurística `extractionLikelyFailed`** em `Source` (computada, não persistida em coluna nova): true quando `rawText !== null && rawText.length < 500`. Threshold de 500 chars cobre PDFs claramente escaneados sem dar falso-positivo em PDFs legítimos curtos (1 pág A4 ≈ 2k+ chars).
- **Badge ⚠️ no `SourceCard`** ao lado do filename quando flag true. Tooltip explica o problema.
- **Warning detalhado** abaixo do card com link clicável pro [smallpdf.com/pdf-ocr](https://smallpdf.com/pdf-ocr) (workaround sem OCR nativo no app — esse fica pra v0.9+).

### Mudado
- `Source` interface ganha campo `extractionLikelyFailed: boolean` em `electron/database/repositories/sources.repo.ts` e `src/types/ipc.ts`. Campo é **derivado** (calculado em `normalize()`) — não exige migration de schema.

### Por que heurística simples
PDF.js retornaria 0 chars pra PDF totalmente imagem. Pdf-parse (que usamos) retorna parcialmente em PDFs mistos. Threshold 500 cobre os 2 casos sem persistência adicional. Quando OCR nativo entrar (v0.9+, ver BACKLOG), a heurística vira gatilho automático do fallback.

---

## v0.8.1 (2026-05-05) — Fix: botão duplicado no ChatPage

### Corrigido
- ChatPage tinha **dois botões "+ Nova conversa"**: um redundante adicionado no header da coluna esquerda + o botão interno do `ChatConversationList`. Removido o do header — `ChatConversationList` já renderiza o seu próprio.
- Limpeza: import `Button` órfão removido.

---

## v0.8.0 (2026-05-05) — Sidebar Notion-style + Chat fullscreen + escopo global

### Adicionado
- **Sidebar redesign Notion-style**: árvore expansível mostrando todas as matérias com seus tópicos abaixo (`▸/▾` toggle). Tópicos carregados lazy ao expandir. Substitui sidebar minimalista (Início + Configurações) por algo navegável. Item "💬 Chat" e "🏠 Início" no topo; "⚙️ Configurações" no fim.
- **Rota `/chat` (chat fullscreen)**: layout 2 colunas — lista de conversas à esquerda, mensagens com input à direita. Escopo default: global (busca em todos os PDFs do app). Reutiliza `ChatMessage`, `ChatInput`, `ChatConversationList`. Ver [ADR-041](DECISIONS.md#adr-041).
- **Escopo `'global'`** no chat: novo valor em `ScopeType` + `RagScope`. RAG resolve via `listAllSources()` em `sources.repo.ts` — busca em todos os PDFs em qualquer matéria/tópico. Suporta perguntas que cruzam material ("o que vimos sobre X em Cálculo e em Probabilidade?").
- **Versão dinâmica na sidebar**: substituiu o `v0.1.0` hardcoded por `app.getVersion()` IPC.

### Mudado
- `Sidebar.tsx` reescrita completamente.
- `chat.service.ts:conversationScopeToRagScope` aceita 'global'.
- `rag.service.ts:resolveSourceIds` aceita 'global'.
- `ChatScopeSchema` em `electron/ipc/schemas.ts` aceita 'global'.
- `App.tsx`: nova rota `/chat`.
- `AppLayout.tsx`: drawer flutuante 💬 e ChatPanel **escondidos quando `location.pathname === '/chat'`** (evita redundância — chat fullscreen já está visível).

### Coexistência (importante)
- **Drawer flutuante 💬 continua funcionando** em todas as rotas EXCETO `/chat`. Quem usava o drawer pra "chatar dentro do tópico atual" não perde funcionalidade.
- /chat fullscreen é caminho NOVO, não substituto imediato. Migração gradual em 2 versões.
- Em v0.8.1+: se `/chat` ganhar dropdown de escopo (topic/subject/global), drawer pode ser removido.

### Ainda não entregue (v0.8.1+)
- Dropdown de escopo dentro de `/chat` (ex: escolher entre Tópico/Matéria/Global)
- Coluna lateral dedicada de "Fontes" no /chat (hoje fontes aparecem inline em cada mensagem assistant, igual no drawer)
- Múltiplas seleções de escopo (planejada pra v0.9+, requer tabela nova `conversation_scopes`)

### Caveats
- `scope_id` para conversa global é o literal `'global'` (NOT NULL no schema obriga). Não muda nada no comportamento; pra multi-user web futura, trocar por `user_id` faz mais sentido.

---

## v0.7.5 (2026-05-05) — Cache in-memory + UX do botão "Sugerir temas"

Continuação do hotfix v0.7.4. Resolve 2 problemas reportados:

### Corrigido
- **Clicar "Sugerir temas" 2x na mesma sessão gastava tokens duas vezes.** O prompt leve da v0.7.4 não cacheava o resultado em lugar nenhum. Agora há cache in-memory por `sourceId` que sobrevive durante a sessão do app — 2ª chamada na mesma source = **zero tokens, instantâneo**.
- **Botão "Sugerir temas" continuava prominente depois dos chips aparecerem**, convidando o aluno a clicar sem querer. Agora quando já há chips, o botão vira um link discreto `↻ Atualizar temas` — não compete visualmente com os chips e ainda permite refresh manual se o aluno quiser.

### Adicionado
- `clearThemeCache(sourceId?)` em `quiz-generator.service.ts`: invalida cache pra uma source específica ou tudo.
- Hook em `files:deleteSource` IPC: quando aluno apaga um PDF, o cache de temas dessa source também é limpo.

### Mudado
- `suggestThemes` agora tem 3 caminhos em ordem de preferência (todos paralelos via Promise.all):
  1. Cache `extracted_concepts` no banco (gerou quiz antes) → instantâneo
  2. Cache in-memory desta sessão (clicou "Sugerir temas" antes) → instantâneo
  3. Prompt leve `suggestThemesFromText` → 1-3s, gasta tokens, popula caminho 2
- UI do `QuizSetup`: botão muda dependendo do estado.

### Sem mudança quando
- Aluno gerou quiz antes na source: continua instantâneo (caminho 1, igual v0.7.3-).
- Aluno re-ingeriu source: cache in-memory limpo automaticamente; próxima chamada gasta tokens (correto).

---

## v0.7.4 (2026-05-05) — UX hotfix: "Sugerir temas" 30-90s → 1-3s

### Corrigido
- **Botão "Sugerir temas" no QuizSetup demorava 30-90s** quando os sources não tinham análise cacheada (1ª vez do aluno mexendo num PDF). O handler chamava `analyzeMaterial` (etapa 1 do pipeline de quiz) sequencialmente pra cada source — análise completa com 50k chars de input + ~3000 tokens de output, 10-25s por source.

### Mudado
- Novo prompt **dedicado leve** em `electron/services/prompts/theme-suggester.ts`: pede apenas 4-8 temas curtos (1-3 palavras), input truncado a 15k chars, output ~150 tokens. **~1-3s por source.**
- `suggestThemes` em `quiz-generator.service.ts` agora:
  1. Source com `extracted_concepts` cacheado → usa direto (instantâneo)
  2. Source sem cache → prompt leve dedicado (não cacheia o resultado, evita desperdiçar tokens em sources que o aluno só "espiou")
  3. Sources rodam em **paralelo** via `Promise.all` (antes era sequencial)
- Dedup case-insensitive preservando ordem (sem mudança visível, só limpeza)

### Por que não cachear o resultado do prompt leve?
Quando o aluno clica em "Gerar quiz", a etapa 1 (análise completa) ainda roda e cacheia tudo (`extracted_concepts`). Cachear o resultado leve sobrescreveria com dado parcial. Assim o cache fica consistente com o pipeline real.

### Sem regressão
Aluno com sources já processados em quiz anterior não vê diferença — caminho do cache continua igual. Mudança só vale na 1ª vez de cada source.

---

## v0.7.3 (2026-05-05) — Fundação pra escala (parte 2): Drizzle ORM

Continuação da v0.7.2. Migra repositories de `better-sqlite3` puro pra
`drizzle-orm` mantendo SQLite por enquanto. Sem mudanças visíveis pro
usuário. Smoke test full passa.

### Adicionado
- **`drizzle-orm@0.45`** como dependency runtime, **`drizzle-kit@0.31`** como devDep
- **`electron/database/drizzle/schema.ts`** — 12 tabelas declaradas em TypeScript, espelhando `schema.sql`. Drizzle infere tipos das queries automaticamente. Ver [ADR-040](DECISIONS.md#adr-040).
- **`drizzle.config.ts`** na raiz — configuração do CLI (`drizzle-kit generate`)
- **`getDrizzleDb()`** em `connection.ts` — wrapper que reusa a mesma conexão `better-sqlite3` (sem dupla conexão)
- **`electron/database/migrations/0000_initial_baseline.sql`** — migration baseline gerada via `drizzle-kit generate`, com FTS5 + 3 triggers anexados manualmente

### Mudado
- **6 repositories migrados pra Drizzle** (`subjects`, `topics`, `sources`, `conversations`, `quizzes`, `chunks`):
  - `prepare<[args], Row>` + `mapRow()` → `db.select().from(...).where(...).get()` com tipos inferidos
  - Transações: `db.transaction(fn)()` → `db.transaction(tx => ...)`
  - IN dinâmico: placeholders manuais → `inArray(field, values)`
  - JOIN + COUNT: `LEFT JOIN ... GROUP BY` → `.leftJoin(...).groupBy(...)` + `count()` agregado
  - Resultado: ~30% menos código (1300 → 900 linhas), tipos inferidos automaticamente

### Não mudou (intencional)
- **`schema.sql` + `applyMigrations` ad-hoc**: continuam sendo o caminho de inicialização do DB. `migrate()` do drizzle-kit **não foi ativado** — DBs legacy quebrariam (CREATE TABLE sem IF NOT EXISTS no baseline). Ativação fica pra v0.8.x quando uma migration nova surgir. Anotado em BACKLOG.
- **`searchChunksByFts` (chunks.repo.ts)**: continua usando SQL raw via `getDb()`. Drizzle não modela `CREATE VIRTUAL TABLE` nem expressões FTS5 (`MATCH`, `bm25()`). Única exceção pós-migração.

### Backlog
- Removida entry "Sistema de migrations" — parcialmente resolvida (estrutura pronta; ativação adiada).
- Nova entry: "Ativar drizzle-kit migrate na próxima migration de schema (bootstrap pra DB legacy)".

### Próximo
- **v0.8.0**: sidebar redesign + chat fullscreen + escopo `'global'` no schema. Será a primeira migration depois da fundação Drizzle — boa oportunidade pra ativar o sistema de migrations versionado.

---

## v0.7.2 (2026-05-05) — Fundação pra escala (parte 1)

Release sem mudanças visíveis pro usuário, focada em preparar o código pra eventual migração futura pra web (Next.js + Supabase). Sem regressões — smoke test full passa.

### Mudado
- **Domínio plataforma-agnóstico via dependency injection**: 4 arquivos (`utils/crypto.ts`, `services/embedding.service.ts`, `database/connection.ts`, `database/lancedb.ts`) que importavam `app`/`safeStorage` de `'electron'` foram refatorados pra receber dependências via `configure*()` chamadas no boot. Audit `grep "from 'electron'" electron/services electron/utils electron/database` agora retorna zero. Ver [ADR-038](DECISIONS.md#adr-038).
- **`main.ts` virou composition root explícito**: dentro de `app.whenReady()`, resolve `userDataPath` + `ElectronSafeStorage` adapter e injeta nos services agnósticos. Ordem de bootstrap clara.
- **Adapter pattern pro safeStorage**: nova interface `SecretStorage` em `crypto.ts`; implementação concreta `ElectronSafeStorage` em `electron/adapters/` (único lugar fora de `main`/`preload`/`ipc` autorizado a importar `'electron'`).
- **Validação de IPC migrada pra Zod**: 37 handlers em 9 arquivos, ~200 linhas de validação manual (`typeof`, `Array.isArray`, range checks) → ~80 linhas de schemas Zod com tipos inferidos. Helper `parseInput()` em `electron/ipc/schemas.ts` centraliza erro estruturado. Schemas reusáveis (`IdSchema`, `NonEmptyStringArraySchema`, `ChatScopeSchema`). Ver [ADR-039](DECISIONS.md#adr-039).

### Adicionado
- **`zod@4`** como dependency runtime
- **`electron/adapters/electron-secret-storage.ts`** (novo) — adapter Electron pra interface SecretStorage
- **`electron/ipc/schemas.ts`** (novo) — schemas Zod compartilhados + helper `parseInput`

### Removido
- **`electron/utils/type-guards.ts`** — `isObject` virou desnecessário com Zod

### Backlog cleanup
Adicionados ao [BACKLOG.md](BACKLOG.md) 7 itens não previamente listados, agora categorizados em "Robustez/Segurança" (rate limit, health check, backup), "Observabilidade" (electron-log + Sentry, structured output Anthropic), e "Tooling/Migração" (Drizzle planejado pra v0.7.3, pdf-parse → pdfjs-dist).

### Próximo
**v0.7.3** — Drizzle migration completa (better-sqlite3 puro → drizzle-orm; sistema de migrations versionado). Plano detalhado em `docs/_internal/web-migration-plan.md`.

---

## v0.7.1 (2026-05-04) — Multi-seleção de temas no quiz

### Adicionado
- **Multi-seleção de temas sugeridos**: chips de tema agora viram **toggle** (clique pra adicionar/remover). Aluno pode selecionar 2-3 temas e gerar um quiz que cobre todos. Antes, clicar num chip substituía o input — agora chips coexistem com o input de texto livre.
- **Combinação automática**: input livre + chips selecionados são juntados num filtro único, separados por vírgula, com dedup case-insensitive ("derivadas, Derivadas" → "derivadas").
- **Contador + botão "limpar"**: aparece quando ≥1 chip está selecionado.

### Mudado
- Prompt da etapa 2 (geração) detecta múltiplos temas separados por vírgula e instrui o modelo a tratar como OR — cada pergunta pode focar em qualquer tema da lista, distribuindo entre eles quando possível.
- Hint do input atualizado: "separe múltiplos temas por vírgula. Chips abaixo também valem (combinam com o texto)".

### Compatibilidade
- 1 tema só funciona exatamente como antes — nenhuma mudança visível pra quem usa o fluxo single-theme.

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
