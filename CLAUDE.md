# tutor.ai — Contexto

## Estado atual
**v0.7.5 (UX hotfix #2)** publicada — cache in-memory de temas (2ª chamada gratuita) + botão "Sugerir temas" vira "↻ Atualizar" discreto quando já tem chips. v0.7.4 entregou prompt leve + paralelização (1-3s). v0.7.3 adotou Drizzle ORM. Próximo: **v0.8.0** (sidebar redesign + chat fullscreen + escopo `global`). Ver [BACKLOG](docs/BACKLOG.md).
Última sessão: 2026-05-05

## O que é este projeto
Desktop app open source de estudo com IA. Usuário sobe PDFs, app gera quizzes/flashcards/exercícios e responde dúvidas baseado **no material dele** (RAG local). Tudo roda offline; só chamada externa é à API Anthropic.

## Onde achar cada coisa
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — schema, deps, design técnico
- [docs/DECISIONS.md](docs/DECISIONS.md) — ADRs com contexto, alternativas e por quê
- [docs/BACKLOG.md](docs/BACKLOG.md) — tech debt e ideias adiadas
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — o que cada release entregou
- [docs/TODO.md](docs/TODO.md) — roadmap por versão (do início do projeto)
- [docs/RAG_EVALUATION.md](docs/RAG_EVALUATION.md) — avaliação empírica do RAG híbrido (v0.6) + bug do backfill FTS5 + recomendações
- Releases publicadas: https://github.com/minepedro/tutor-ai/tags

## Convenções
- TypeScript estrito, sem `any`
- Sem ORM; SQL puro com `better-sqlite3`
- IPC tipado em 3 lugares síncronos: `src/types/ipc.ts` → `electron/preload.ts` → `electron/ipc/<entity>.ipc.ts` (ver [ADR-008](docs/DECISIONS.md#adr-008))
- Repositories pattern em `electron/database/repositories/<entity>.repo.ts` (ver [ADR-015](docs/DECISIONS.md#adr-015))
- Comentários e UI em português; identificadores em inglês
- Commits convencionais (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Dark theme padrão (cores em `src/styles/globals.css`)

## Notas para Claude Code
- **Sempre rodar `npm run typecheck` antes de declarar pronto.** 80% dos casos têm algum erro de tipo silencioso.
- **Mexeu em `electron/main.ts` ou `electron/preload.ts`?** Mate o `npm run dev` e re-rode. HMR não cobre main process.
- **Antes de editar `docs/ARCHITECTURE.md`:** mostrar resumo das mudanças e pedir aprovação. CLAUDE.md pode atualizar proativamente.
- **Antes de criar uma ADR nova:** confirma que a decisão é não-trivial (ver critérios em DECISIONS.md). Triviais vão no commit message.
- **Nunca rodar `git push`, `gh pr create`** sem permissão explícita.
- **Inspeção rápida do banco:** `npx tsx scripts/inspect-db.ts` (usa `node:sqlite` builtin, não conflita com better-sqlite3 buildado pra Electron).
