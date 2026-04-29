# Prompt Inicial para Claude Code — tutor.ai

## Contexto

Estou construindo o **tutor.ai**, um app desktop open source de estudo com IA. O usuário sobe material de estudo (PDFs, textos) e a IA gera quizzes, flashcards e resolve exercícios. Tudo roda localmente, os dados ficam no computador do usuário.

A documentação completa está em dois arquivos no repositório:
- `docs/ARCHITECTURE.md` — arquitetura, stack, schema do banco, pipeline de quiz, sistema de RAG, estrutura de pastas, segurança
- `docs/TODO.md` — roadmap com todas as versões (v0.1 a v2.0), cada tarefa com checkbox

**Leia ambos os arquivos antes de começar qualquer implementação.**

## Stack

- **Desktop:** Electron 33+
- **Frontend:** React 19 + Vite 6 + TypeScript
- **Estilização:** Tailwind CSS 4
- **Roteamento:** React Router 7
- **Banco de dados:** better-sqlite3 (SQLite, sem ORM)
- **Embeddings:** onnxruntime-node + all-MiniLM-L6-v2
- **Busca vetorial:** LanceDB
- **IA:** API Anthropic (Claude Sonnet) via @anthropic-ai/sdk
- **Segurança:** Electron safeStorage para API key
- **Build:** electron-builder

## Comando inicial

```
Leia docs/ARCHITECTURE.md e docs/TODO.md.
Vamos começar pela v0.1.0 (Fundação).
Planeje a implementação — quais arquivos criar e em qual ordem.
Depois implemente passo a passo.
```

## Regras de desenvolvimento

1. **TypeScript estrito** — sem `any`, tipar tudo
2. **Sem ORM** — queries SQL diretas com better-sqlite3 e prepared statements
3. **IPC tipado** — o renderer nunca acessa Node.js diretamente, tudo via preload.ts/contextBridge
4. **Dark theme** — cores base: bg #08080d/#111119, accent #7c5cfc, fontes Outfit + JetBrains Mono
5. **Commits convencionais** — feat:, fix:, refactor:, docs:, chore:
6. **Um arquivo por vez** — implemente, teste, commite, próximo

## Observações importantes

- Não sou familiarizado com TypeScript, então explique trechos que usem conceitos avançados (generics, utility types, etc)
- O projeto é open source (MIT) — qualquer pessoa deve conseguir clonar, instalar e rodar com `npm install` + `npm run dev`
- A API key do Claude é fornecida pelo próprio usuário — nunca hardcoded
- Prefiro que pergunte antes de tomar decisões arquiteturais que não estão no ARCHITECTURE.md
- Prefiro explicações antes de código quando o conceito for novo para mim
