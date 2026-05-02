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
  pageCount: number;
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
