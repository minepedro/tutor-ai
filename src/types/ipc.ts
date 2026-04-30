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
