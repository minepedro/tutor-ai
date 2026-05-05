/**
 * Contratos IPC — fonte única da verdade dos métodos que o renderer pode chamar.
 *
 * Quando adicionar um IPC novo, edite a interface aqui e o TypeScript vai
 * apontar tudo que precisa atualizar (preload.ts e o handler no main).
 */

export interface IpcApi {
  app: AppApi;
  settings: SettingsApi;
  setup: SetupApi;
  subjects: SubjectsApi;
  topics: TopicsApi;
  sources: SourcesApi;
  files: FilesApi;
  embeddings: EmbeddingsApi;
  quizzes: QuizzesApi;
  chat: ChatApi;
}

/*
  Plataformas que `process.platform` pode retornar (Node.js).
  Definido localmente em vez de usar `NodeJS.Platform` para não obrigar o
  renderer a carregar @types/node — ele não precisa de nada do Node.
*/
export type Platform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd';

export interface AppApi {
  /** Versão do package.json. */
  getVersion(): Promise<string>;
  /** 'win32' | 'darwin' | 'linux' | ... */
  getPlatform(): Promise<Platform>;
}

export interface SettingsApi {
  saveApiKey(key: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  /** Retorna a API key decriptada, ou null se não houver nenhuma salva. */
  loadApiKey(): Promise<string | null>;
  getEncryptionStatus(): Promise<EncryptionStatus>;
  /** Apaga DB, modelo, embeddings e a API key. Volta o app pra estado inicial. */
  clearAll(): Promise<void>;
}

export interface SetupApi {
  /** Inicia o download do modelo ONNX. Progresso via onProgress(). */
  downloadModel(): Promise<void>;
  /** Retorna true se o modelo já foi baixado. */
  isModelReady(): Promise<boolean>;
  /**
   * Registra um listener para eventos de progresso do download.
   * Retorna uma função de cleanup para cancelar a subscrição.
   *
   * 💡 Funções não podem trafegar por IPC (JSON não serializa código).
   *    O padrão correto é: main envia eventos via webContents.send(),
   *    o preload escuta com ipcRenderer.on() e repassa ao renderer.
   *    O renderer nunca toca no ipcRenderer diretamente.
   */
  onProgress(callback: (pct: number, status: string) => void): () => void;
}

export type EncryptionStatus = 'os-backed' | 'plaintext-fallback' | 'unavailable';

/*
  💡 Tipo "Subject" da entidade — espelha as colunas da tabela `subjects`
  com nomes em camelCase. O repo no main faz o mapeamento snake_case → camelCase.

  Esse tipo vive aqui (em types/ipc.ts) porque trafega por IPC. Tipos que
  só existem no main (ex: SubjectRow do banco) ficam confinados no repo.
*/
export interface Subject {
  id: string;
  name: string;
  /** Cor hex (ex: '#7c5cfc'). Default no banco se não fornecida. */
  color: string;
  /** Emoji único representando a matéria. Default '📚'. */
  emoji: string;
  /** ISO-like 'YYYY-MM-DD HH:MM:SS' (formato do SQLite CURRENT_TIMESTAMP). */
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectInput {
  name: string;
  color?: string;
  emoji?: string;
}

export type UpdateSubjectInput = Partial<CreateSubjectInput>;

export interface SubjectsApi {
  list(): Promise<Subject[]>;
  get(id: string): Promise<Subject | null>;
  create(input: CreateSubjectInput): Promise<Subject>;
  update(id: string, patch: UpdateSubjectInput): Promise<Subject>;
  delete(id: string): Promise<void>;
}

/*
  Tópicos pertencem a uma matéria (FK + ON DELETE CASCADE no schema).
  `description` é opcional na criação e pode ser `null` no update — passar
  `null` explicitamente é o jeito de limpar a descrição.
*/
export interface Topic {
  id: string;
  subjectId: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface CreateTopicInput {
  subjectId: string;
  name: string;
  description?: string;
}

export interface UpdateTopicInput {
  name?: string;
  description?: string | null;
}

export interface TopicsApi {
  listBySubject(subjectId: string): Promise<Topic[]>;
  get(id: string): Promise<Topic | null>;
  create(input: CreateTopicInput): Promise<Topic>;
  update(id: string, patch: UpdateTopicInput): Promise<Topic>;
  delete(id: string): Promise<void>;
}

/*
  Sources são materiais (PDFs, textos) ligados a um tópico. v0.2.0 só suporta PDF.
  `rawText` e `extractedConcepts` ficam null até o pipeline de ingestão (Fase E/F)
  processar o arquivo.
*/
export type SourceFileType = 'pdf' | 'txt' | 'url' | 'paste';

export interface Source {
  id: string;
  topicId: string;
  filename: string;
  fileType: SourceFileType;
  /** SHA-256 do conteúdo. Usado para dedup em disco e no banco. */
  contentHash: string;
  /** Caminho absoluto no disco (userData/sources/<hash>.<ext>). */
  filePath: string;
  rawText: string | null;
  extractedConcepts: string | null;
  /** Número de chunks indexados. 0 enquanto o pipeline de ingestão não rodou. */
  chunkCount: number;
  /**
   * Heurística (v0.8.3+): true se a extração de texto extraiu pouquíssimo
   * conteúdo (< 500 chars) — sinal forte de PDF escaneado/imagem. UI mostra
   * badge ⚠️ sugerindo OCR externo.
   */
  extractionLikelyFailed: boolean;
  createdAt: string;
}

export interface SourcesApi {
  listByTopic(topicId: string): Promise<Source[]>;
  get(id: string): Promise<Source | null>;
}

/*
  Operações de upload/exclusão de arquivos. Vivem fora de `sources` porque
  envolvem efeitos colaterais no disco (file dialog, copy, unlink), não só DB.
*/
export interface FilesApi {
  /**
   * Abre o file dialog do SO em multi-select. Retorna a lista de sources
   * processadas (vazia se cancelou ou se nada foi escolhido).
   *
   * Idempotente por arquivo: se um SHA-256 já existe no tópico, retorna a
   * source existente em vez de criar uma nova.
   */
  pickAndUpload(topicId: string): Promise<Source[]>;
  /**
   * Versão para drag-and-drop. O renderer resolve os paths via
   * `getDroppedPath` (preload) e envia a lista pra cá.
   */
  uploadFromPaths(topicId: string, paths: string[]): Promise<Source[]>;
  /**
   * Remove a linha em `sources` e (se for a última referência) o arquivo no disco.
   * Também limpa os vetores associados no LanceDB.
   */
  deleteSource(sourceId: string): Promise<void>;
  /**
   * Resolve o caminho absoluto de um File arrastado do SO. Síncrono — chama
   * `webUtils.getPathForFile` direto no preload.
   *
   * 💡 Em Electron 32+ a propriedade `file.path` foi removida; este é o
   * substituto oficial. Precisa rodar no mesmo process que recebeu o drag.
   */
  getDroppedPath(file: File): string;
}

/*
  Pipeline de ingestão: extrai texto, divide em chunks, gera embeddings,
  persiste em SQLite (texto) e LanceDB (vetores).

  O progresso é reportado via `onProgress` (event-based, igual ao SetupApi).
  O sourceId vem em cada evento — abre porta pra rodar várias ingestões em
  paralelo no futuro sem confundir o estado da UI.
*/
export interface IngestResult {
  sourceId: string;
  chunkCount: number;
  /** Número de páginas do PDF. Ausente quando o pipeline reaproveita chunks
   *  de outra source via dedup (não lê o PDF nesse caso). */
  pageCount?: number;
  /** True se os chunks foram copiados de uma source existente com mesmo
   *  content_hash em vez de re-processados. */
  reused?: boolean;
}

export interface EmbeddingProgress {
  sourceId: string;
  pct: number;
  status: string;
}

export interface EmbeddingsApi {
  /**
   * Processa uma source (PDF) — texto + chunks + embeddings.
   * Pode demorar (segundos a minutos dependendo do tamanho). Use onProgress()
   * pra mostrar feedback ao usuário.
   */
  ingest(sourceId: string): Promise<IngestResult>;
  /** Conta quantos chunks já existem indexados para esta source. */
  countBySource(sourceId: string): Promise<number>;
  /**
   * Subscribe a eventos de progresso. Retorna função de cleanup.
   */
  onProgress(callback: (event: EmbeddingProgress) => void): () => void;
}

/*
  ─── Quizzes ──────────────────────────────────────────────────────────────
  Geração + persistência + jogada de quizzes.

  Gerar um quiz é uma operação cara (~3 chamadas à API Anthropic, ~30s pra
  10 perguntas). Por isso usa o mesmo padrão de progresso event-based que
  embeddings: `generate()` resolve no fim, mas `onProgress` empurra eventos
  durante o processo (Análise → Geração → Validação).
*/

export type QuestionType = 'multiple_choice' | 'true_false';
export type QuestionTypePref = QuestionType | 'mixed';
export type QuestionDifficulty = 'easy' | 'medium' | 'hard';
export type QuizMode = 'quick' | 'quality';

export interface QuizQuestion {
  id: string;
  quizId: string;
  type: QuestionType;
  difficulty: QuestionDifficulty;
  question: string;
  options: string[];
  /** Index 0-based da opção correta. */
  correctIndex: number;
  /** Resposta do usuário; null se ainda não respondeu. */
  selectedIndex: number | null;
  /** Resultado da resposta; null se ainda não respondeu. */
  isCorrect: boolean | null;
  explanation: string;
  /** Reservado pra v0.4.0 (chat inline na pergunta). */
  doubtQuestion: string | null;
  doubtResponse: string | null;
  answeredAt: string | null;
}

export interface Quiz {
  id: string;
  topicId: string;
  /** Null se quiz veio de múltiplas sources do mesmo tópico. */
  sourceId: string | null;
  title: string | null;
  quizMode: QuizMode;
  totalQuestions: number;
  /** Número de acertos; null se ainda não foi finalizado. */
  score: number | null;
  timeSpentSeconds: number | null;
  completedAt: string | null;
  createdAt: string;
  questions: QuizQuestion[];
}

/** Versão leve do Quiz pra listagem (sem perguntas). */
export interface QuizSummary {
  id: string;
  topicId: string;
  sourceId: string | null;
  title: string | null;
  totalQuestions: number;
  score: number | null;
  completedAt: string | null;
  createdAt: string;
}

export interface GenerateQuizInput {
  topicId: string;
  /** Pelo menos 1. Se múltiplos, source_id no quiz fica null. */
  sourceIds: string[];
  /** 3-30 perguntas (validado no backend). */
  count: number;
  types: QuestionTypePref;
  /** Filtro de tema livre opcional. */
  themeFilter?: string;
  /** Título amigável (default: nome do tópico + data). */
  title?: string;
}

export interface QuizGenerationProgress {
  pct: number;
  status: string;
}

export interface GenerateQuizResult {
  quiz: Quiz;
  /** Quantas perguntas o modelo gerou antes da validação. */
  totalGenerated: number;
  /** Quantas sobreviveram à validação. */
  totalValidated: number;
  /**
   * False quando o filtro de tema foi passado mas nenhuma pergunta resultou
   * (geralmente porque o tema não está no material). UI mostra mensagem
   * específica nesse caso. Quando false, `quiz` é null.
   */
  themeMatched: boolean;
}

export interface QuizzesApi {
  /**
   * Gera um quiz novo: análise → geração → validação → persiste.
   * Pode demorar ~15-60s. Use `onProgress` pra feedback.
   */
  generate(input: GenerateQuizInput): Promise<GenerateQuizResult>;
  /** Sugere temas baseado no material (botão "Sugerir temas" no QuizSetup). */
  suggestThemes(sourceIds: string[]): Promise<string[]>;
  /** Busca quiz pelo id, com perguntas. */
  get(id: string): Promise<Quiz | null>;
  /** Lista quizzes de um tópico (ordem decrescente, sem perguntas). */
  listByTopic(topicId: string): Promise<QuizSummary[]>;
  /**
   * Registra resposta do usuário a uma pergunta. Marca isCorrect.
   * Não atualiza score do quiz — chamar `finish()` quando termina.
   */
  answer(questionId: string, selectedIndex: number): Promise<QuizQuestion>;
  /**
   * Finaliza o quiz: calcula score, marca completedAt, salva tempo gasto.
   */
  finish(quizId: string, timeSpentSeconds: number): Promise<Quiz>;
  delete(id: string): Promise<void>;
  /**
   * "Refazer" o mesmo quiz: limpa as respostas mas mantém as perguntas.
   * Zero tokens — não chama a API. Usuário responde as mesmas de novo.
   */
  reset(id: string): Promise<Quiz>;
  /** Renomeia só o título do quiz. Outros campos não mudam. */
  rename(id: string, title: string): Promise<Quiz>;
  /** Subscribe a eventos de progresso da geração. Retorna cleanup. */
  onProgress(callback: (event: QuizGenerationProgress) => void): () => void;
}

/*
  ─── Chat (RAG) ───────────────────────────────────────────────────────────
  Conversas escopadas em document/topic/subject. Mensagens persistem; ao
  enviar, o backend busca chunks relevantes (RAG), monta contexto e chama
  Claude. A resposta volta junto com os chunks usados (UI mostra fontes).

  v0.4.0 não suporta `inline` ainda (escopo dentro do quiz/flashcard) — vai
  pra v0.5+.
*/

export type ChatScopeType =
  | 'inline'
  | 'document'
  | 'topic'
  | 'subject'
  | 'quiz_question'
  | 'global';
export type ChatMessageRole = 'user' | 'assistant';

export interface ChatScope {
  scopeType: ChatScopeType;
  scopeId: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatMessageRole;
  content: string;
  /** IDs dos chunks usados como contexto (preenchido só em mensagens 'assistant'). */
  contextChunkIds: string[] | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  scopeType: ChatScopeType;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  scopeType: ChatScopeType;
  scopeId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Primeiros ~80 chars da última mensagem (pra preview na lista lateral). */
  preview: string | null;
}

export interface CreateConversationInput extends ChatScope {
  title?: string | null;
}

/**
 * Chunk retornado junto com a resposta do chat — UI usa pra mostrar "fontes".
 * Inclui filename do PDF original e índice do chunk pra citação.
 */
export interface ChatRagChunk {
  chunkId: string;
  sourceId: string;
  sourceFilename: string;
  chunkIndex: number;
  /** Página (1-based) onde o chunk se origina. Null pra chunks gerados antes da v0.5. */
  pageNumber: number | null;
  /** Label estrutural detectado ("exercício 5", "capítulo 3"). Null se chunk é texto contínuo. */
  structuralLabel: string | null;
  content: string;
  /** Cosine distance: menor = mais similar à pergunta. */
  distance: number;
}

export interface SendMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  /** Chunks que entraram no contexto da resposta. Pode ser vazio se RAG não achou nada. */
  chunks: ChatRagChunk[];
}

export interface QuizDoubtResult {
  /** Conversation usada (criada lazy se não existia). */
  conversation: Conversation;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface ChatApi {
  /** Lista conversas de um escopo (mais recentes primeiro). */
  listConversations(scope: ChatScope): Promise<ConversationSummary[]>;
  /** Busca conversa pelo id, com todas as mensagens em ordem cronológica. */
  get(id: string): Promise<Conversation | null>;
  /** Cria conversa nova (ainda vazia, sem mensagens). */
  create(input: CreateConversationInput): Promise<Conversation>;
  /**
   * Envia mensagem do usuário. Backend executa o pipeline RAG + Claude e
   * persiste user msg + assistant response. Retorna ambas + chunks usados.
   *
   * 💡 O escopo da busca RAG é derivado da CONVERSA (não da rota atual).
   * Isso garante coerência: se o usuário mudar de tópico no meio da conversa,
   * o RAG continua usando o escopo original em que ela foi criada.
   *
   * Pode demorar ~3-8s (1 chamada de embedding + 1 de Claude). Sem
   * streaming na v0.4.0 — ver decisão em ADR (v0.4.1+ pode adicionar).
   */
  sendMessage(conversationId: string, content: string): Promise<SendMessageResult>;
  /**
   * Chat inline em pergunta de quiz (v0.7.0). Cria conversation lazy
   * (1:1 com a pergunta) na primeira chamada. Pipeline mais simples que
   * `sendMessage`: SEM RAG, SEM rewriter — contexto da pergunta vai no
   * system prompt e sobrevive ao sliding window.
   */
  askQuizDoubt(quizQuestionId: string, content: string): Promise<QuizDoubtResult>;
  /**
   * Recupera a conversation de dúvidas de uma pergunta de quiz (com mensagens).
   * Retorna null se o aluno ainda não abriu o chat dessa pergunta.
   */
  getQuizDoubt(quizQuestionId: string): Promise<Conversation | null>;
  rename(id: string, title: string): Promise<Conversation>;
  delete(id: string): Promise<void>;
}

/*
  💡 `declare global` injeta tipos no escopo global. Aqui estamos dizendo:
  "Todo lugar do projeto que mexe com `window` vai ter `.api` tipado como IpcApi."
  Sem isso, o renderer veria `window.api` como `any` e perderíamos o autocompletar.

  O `export {}` no fim é necessário porque um arquivo .ts com `declare global`
  só é tratado como módulo (e não como script) se tiver pelo menos um import/export.
  Se virar script, o `declare global` redefiniria tipos globalmente sem isolamento.
*/
declare global {
  interface Window {
    readonly api: IpcApi;
  }
}

export {};
