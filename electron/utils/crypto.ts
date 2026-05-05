import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EncryptionStatus } from '@shared/ipc';

/*
  Storage de API key, plataforma-agnóstico (v0.7.2).

  Encriptação OS-backed depende do Electron `safeStorage`, que importa de
  `'electron'`. Pra manter este módulo livre de Electron (regra de domínio
  agnóstico — ver ADR-038), expomos uma interface `SecretStorage` que o caller
  injeta. A implementação concreta com Electron vive em
  `electron/adapters/electron-secret-storage.ts` — único lugar permitido a
  importar `safeStorage`/`app` fora de `main.ts`/`preload.ts`/`ipc/`.

  Em ambientes onde encriptação não está disponível (Linux sem keyring,
  testes, ambiente futuro web/Node-only), a implementação retorna `null`/
  `false` e este módulo cai num fallback base64 (ofuscação simples — UI
  mostra aviso de segurança).
*/

export interface SecretStorage {
  /** True se o backend pode encriptar. False → cai no fallback ofuscado. */
  isAvailable(): boolean;
  /** Retorna buffer encriptado ou null se não disponível. */
  encrypt(plaintext: string): Buffer | null;
  /** Retorna texto desencriptado ou null se falhar/não disponível. */
  decrypt(cipher: Buffer): string | null;
}

function getKeyFilePath(userDataPath: string): string {
  return join(userDataPath, '.apikey');
}

export function getEncryptionStatus(storage: SecretStorage): EncryptionStatus {
  return storage.isAvailable() ? 'os-backed' : 'unavailable';
}

export function saveApiKey(
  storage: SecretStorage,
  userDataPath: string,
  key: string,
): void {
  const filePath = getKeyFilePath(userDataPath);

  const encrypted = storage.encrypt(key);
  if (encrypted) {
    writeFileSync(filePath, encrypted);
  } else {
    // Fallback ofuscado (não encriptado). UI mostra aviso de segurança.
    writeFileSync(filePath, Buffer.from(key).toString('base64'), 'utf-8');
  }
}

export function loadApiKey(
  storage: SecretStorage,
  userDataPath: string,
): string | null {
  const filePath = getKeyFilePath(userDataPath);
  if (!existsSync(filePath)) return null;

  try {
    const data = readFileSync(filePath);
    if (storage.isAvailable()) {
      return storage.decrypt(data);
    }
    // Fallback: decodifica base64
    return Buffer.from(data.toString('utf-8'), 'base64').toString('utf-8');
  } catch {
    // Arquivo corrompido ou encriptado com outra conta.
    return null;
  }
}

export function hasApiKey(
  storage: SecretStorage,
  userDataPath: string,
): boolean {
  return (
    existsSync(getKeyFilePath(userDataPath)) &&
    loadApiKey(storage, userDataPath) !== null
  );
}

export function deleteApiKey(userDataPath: string): void {
  const filePath = getKeyFilePath(userDataPath);
  if (existsSync(filePath)) rmSync(filePath);
}
