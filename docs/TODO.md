# tutor.ai — Roadmap & Versionamento

## Status dos ícones
- ⬜ Pendente
- 🔨 Em desenvolvimento
- ✅ Concluído

---

## v0.1.0 — Fundação
*O app abre, conecta, e salva dados*

- ⬜ Setup do projeto Electron + React + Vite + TypeScript + Tailwind
- ⬜ Configuração do tsconfig.json (renderer) e tsconfig.node.json (electron)
- ⬜ Configuração do vite.config.ts com Electron
- ⬜ Configuração do tailwind.config.ts com dark theme
- ⬜ Electron main.ts: criar janela, configurar CSP
- ⬜ Electron preload.ts: contextBridge com IPC tipado
- ⬜ SQLite: connection.ts + executar schema.sql na primeira inicialização
- ⬜ Schema completo do banco (todas as tabelas)
- ⬜ Settings IPC: salvar/ler API key via safeStorage
- ⬜ Tela Onboarding.tsx: colar API key no primeiro acesso
- ⬜ Tela Settings.tsx: alterar API key, limpar dados
- ⬜ ONNX: embedding.service.ts carregando modelo all-MiniLM-L6-v2
- ⬜ Script setup-models.ts: baixar modelo ONNX automaticamente
- ⬜ LanceDB: inicialização e conexão
- ⬜ Design system base: Button, Card, Input, Modal, Progress
- ⬜ Layout base: AppLayout com Sidebar + Header
- ⬜ Dark theme global (globals.css com variáveis)
- ⬜ Verificação: app abre, salva API key, banco funciona, ONNX carrega

---

## v0.2.0 — Organização
*O usuário cria sua estrutura de estudo*

- ⬜ Repository: subjects.repo.ts (CRUD completo)
- ⬜ Repository: topics.repo.ts (CRUD completo)
- ⬜ IPC handlers: database.ipc.ts para subjects e topics
- ⬜ Hook: useSubjects.ts
- ⬜ Componente: SubjectCard.tsx (card com nome, emoji, cor, stats)
- ⬜ Tela Home.tsx: dashboard com grid de matérias + botão criar nova
- ⬜ Modal: criar/editar matéria (nome, emoji, cor)
- ⬜ Tela SubjectView.tsx: lista de tópicos da matéria
- ⬜ Modal: criar/editar tópico
- ⬜ IPC handlers: files.ipc.ts para upload de arquivos
- ⬜ Utils: pdf-parser.ts (extração de texto via pdf-parse ou similar)
- ⬜ Utils: text-chunker.ts (divide texto em chunks de ~500 tokens)
- ⬜ IPC handlers: embeddings.ipc.ts
- ⬜ Fluxo de upload: selecionar arquivo → escolher matéria/tópico → salvar
- ⬜ Processamento: extrair texto → chunkar → gerar embeddings → salvar no LanceDB
- ⬜ Repository: chunks.repo.ts
- ⬜ Armazenamento dos PDFs originais na pasta sources/
- ⬜ Verificação: criar matéria, tópico, subir PDF, chunks salvos com embeddings

---

## v0.3.0 — Quiz
*O core do produto funciona*

- ⬜ Prompts: quiz-analysis.ts (etapa 1 — extrai conceitos)
- ⬜ Prompts: quiz-generation.ts (etapa 2 — gera perguntas)
- ⬜ Prompts: quiz-validation.ts (etapa 3 — valida qualidade)
- ⬜ Service: quiz-generator.service.ts (pipeline de 3 etapas)
- ⬜ Service: claude.service.ts (chamadas à API com error handling)
- ⬜ IPC: claude.ipc.ts (proxy seguro para API)
- ⬜ Repository: quizzes.repo.ts (salvar quiz + perguntas)
- ⬜ Hook: useQuiz.ts (estado do quiz: current question, selected, score)
- ⬜ Tela QuizSetup.tsx: upload de material + selecionar matéria/tópico + config
  - Opção: quantidade de perguntas (5, 10, 15, 20)
  - Opção: modo quick vs quality
  - Opção: tipo de pergunta (múltipla escolha, V/F, misto)
- ⬜ Componente: QuizProgress.tsx (barra de progresso com steps como no protótipo)
- ⬜ Tela QuizPlay.tsx
  - Componente: QuizCard.tsx (pergunta + tipo badge)
  - Componente: QuizOption.tsx (alternativa com estados: default, correct, wrong)
  - Componente: QuizExplanation.tsx (explicação pós-resposta)
  - Botão "Próxima" / "Ver Resultado"
- ⬜ Tela QuizReview.tsx: revisar todas as respostas após terminar
- ⬜ Componente: QuizResults.tsx (score, acertos/erros, pontos fracos)
- ⬜ Histórico: lista de quizzes feitos por tópico com score e data
- ⬜ Salvamento completo no banco (quiz + todas as perguntas + respostas)
- ⬜ Verificação: gerar quiz de PDF real, jogar, ver resultado, dados salvos

---

## v0.4.0 — Chat
*O tutor ganha voz*

- ⬜ Service: rag.service.ts
  - Receber pergunta → gerar embedding → buscar no LanceDB → montar contexto
  - Sliding window: manter últimas 10 mensagens + resumo das anteriores
- ⬜ Repository: conversations.repo.ts (CRUD conversas + mensagens)
- ⬜ Hook: useChat.ts (estado do chat, enviar mensagem, histórico)
- ⬜ Prompts: chat-tutor.ts (system prompt do chat)
  - Regra: responder apenas com base nos trechos fornecidos
  - Regra: citar fonte ("De acordo com o slide 14...")
  - Regra: dizer quando não encontrou a informação no material
- ⬜ Componente: ChatPanel.tsx (drawer lateral, abre em qualquer tela)
- ⬜ Componente: ChatMessage.tsx (mensagem user/assistant com estilo)
- ⬜ Componente: ChatInput.tsx (input + enviar + loading)
- ⬜ Chat contextual no quiz: contexto = pergunta atual + explicação + material
- ⬜ Chat de documento: contexto = top 5 chunks via RAG
- ⬜ Chat de tópico: busca em todos os docs do tópico
- ⬜ Chat de matéria: busca em todos os docs da matéria
- ⬜ Detecção automática de escopo baseado na tela atual
- ⬜ Histórico de conversas salvo no SQLite
- ⬜ Verificação: chat funciona em todos os contextos, RAG retorna chunks relevantes

---

## v1.0.0 — Release Público
*Pronto para o GitHub*

- ⬜ README.md bilíngue (PT-BR + EN)
  - O que é o projeto
  - Screenshots/GIFs do app
  - Como instalar (3 passos)
  - Como configurar a API key
  - Como usar
  - Stack tecnológica
  - Como contribuir
- ⬜ CONTRIBUTING.md: guia para contribuidores
- ⬜ LICENSE: MIT
- ⬜ .env.example documentado
- ⬜ Script de setup automatizado (npm run setup → instala deps + baixa ONNX)
- ⬜ electron-builder.yml configurado para Win/Mac/Linux
- ⬜ GitHub Actions: build automático nos releases (gera .exe, .dmg, .AppImage)
- ⬜ Testes básicos das funcionalidades core
- ⬜ Polish de UI: animações, transições, edge cases
- ⬜ Correção de bugs encontrados durante uso
- ⬜ Verificação: clonar repo limpo, seguir README, app funciona

---

## v1.1.0 — Flashcards

- ⬜ Prompts: flashcard-generation.ts
- ⬜ Repository: flashcards.repo.ts (CRUD + queries de spaced repetition)
- ⬜ Service: spaced-repetition.service.ts (algoritmo FSRS)
- ⬜ Hook: useFlashcards.ts
- ⬜ Geração de flashcards a partir do material uploadado
- ⬜ Componente: FlashcardViewer.tsx (card com animação de flip)
- ⬜ Componente: FlashcardRating.tsx (botões: errei / difícil / ok / fácil)
- ⬜ Componente: FlashcardDeck.tsx (sessão de estudo)
- ⬜ Tela FlashcardStudy.tsx: sessão com spaced repetition
- ⬜ Contador de flashcards pendentes para revisar hoje (badge na sidebar)
- ⬜ Chat contextual no flashcard (dúvida sobre o card atual)
- ⬜ Histórico de reviews salvo no banco
- ⬜ Verificação: gerar flashcards, estudar, spaced repetition funciona

---

## v1.2.0 — Exercise Solver

- ⬜ Prompts: exercise-solver.ts
- ⬜ Repository: exercises.repo.ts
- ⬜ Upload de lista de exercícios (PDF)
- ⬜ Componente: ExerciseViewer.tsx (enunciado + resolução)
- ⬜ Componente: ExerciseSteps.tsx (passo a passo)
- ⬜ Tela ExerciseSolver.tsx
  - IA resolve e explica passo a passo
  - Campo para o usuário mandar sua resposta
  - IA compara e aponta onde errou
  - Chat contextual no exercício
- ⬜ Salvamento do exercício resolvido no banco
- ⬜ Verificação: subir lista, IA resolver, comparar resposta do aluno

---

## v1.3.0 — Stats e Evolução

- ⬜ Dashboard de desempenho por matéria
- ⬜ Gráficos de evolução ao longo do tempo (score por semana/mês)
- ⬜ Mapa de pontos fracos por tópico
- ⬜ Sugestão automática do que revisar ("Você não estuda X há 7 dias")
- ⬜ Tela Library.tsx: todos os materiais salvos com busca
- ⬜ Export/Import de dados (zip da pasta userData)
- ⬜ Verificação: stats refletem dados reais, sugestões fazem sentido

---

## v2.0.0 — Expansão

- ⬜ Suporte a vídeos do YouTube (transcrição + geração de material)
- ⬜ Múltiplos providers de IA (OpenAI, Gemini)
- ⬜ Light theme como opção
- ⬜ Internacionalização (interface em inglês)
- ⬜ Modo competitivo (sala local para jogar quiz com amigos)
- ⬜ Verificação: todas as features novas funcionam de ponta a ponta

---

## Backlog — Features Futuras (sem versão definida)

- ⬜ **Quiz inteligente de pontos fracos**: o sistema analisa as perguntas que o usuário mais erra (query no banco agrupando erros por tópico), busca o material relevante via RAG, e gera um quiz personalizado focado nos pontos fracos. Não é um agente — é um fluxo determinístico: query SQL → busca vetorial → prompt direcionado → quiz. Poderia ser um botão "Treinar pontos fracos" no dashboard ou na tela de resultados do quiz.
- ⬜ Modo de jogos variados (contra o relógio, sobrevivência, matching, ordenação)
- ⬜ Suporte a imagens dentro de flashcards e quizzes
- ⬜ OCR para PDFs escaneados
- ⬜ Integração com calendário de provas (sugerir o que estudar baseado em datas)

---

## Notas de Desenvolvimento

### Ordem de execução dentro de cada versão
1. Começar com Opus para planejar a implementação
2. Implementar com Sonnet, uma tarefa por vez
3. Testar cada feature isoladamente
4. Commitar após cada feature funcionando
5. Review final com Opus se necessário

### Regra de commit
- feat: nova funcionalidade
- fix: correção de bug
- refactor: mudança de código sem alterar comportamento
- docs: documentação
- style: formatação, sem mudança de lógica
- chore: configs, dependências, scripts

### Branches
- main: versão estável
- develop: desenvolvimento ativo
- feature/*: features individuais (merge para develop)
- release/*: preparação de release (merge para main + tag)
