import { safeStorage, app } from 'electron';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { EncryptionStatus } from '@shared/ipc';

/*
  safeStorage do Electron encripta dados usando o mecanismo nativo do SO:
  - Windows: DPAPI (Data Protection API) — vinculado ao usuário do Windows
  - macOS: Keychain
  - Linux: libsecret / kwallet (se disponível), senão sem encriptação real

  Se `safeStorage.isEncryptionAvailable()` retornar false (Linux sem keyring),
  salvamos em plaintext com um aviso — melhor do que não funcionar.
*/

function getKeyFilePath(): string {
  return join(app.getPath('userData'), '.apikey');
}

export function getEncryptionStatus(): EncryptionStatus {
  if (!safeStorage.isEncryptionAvailable()) return 'unavailable';
  // No Linux, safeStorage pode estar disponível mas em modo "basic" (sem keyring).
  // isEncryptionAvailable() retorna true nesses casos — tratamos como os-backed.
  return 'os-backed';
}

export function saveApiKey(key: string): void {
  const filePath = getKeyFilePath();

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(key);
    writeFileSync(filePath, encrypted);
  } else {
    // Fallback: salva em base64 (ofuscado, não encriptado).
    // O renderer vai mostrar um aviso de segurança nesse caso.
    writeFileSync(filePath, Buffer.from(key).toString('base64'), 'utf-8');
  }
}

export function loadApiKey(): string | null {
  const filePath = getKeyFilePath();
  if (!existsSync(filePath)) return null;

  try {
    const data = readFileSync(filePath);

    if (safeStorage.isEncryptionAvailable()) {
      // data é um Buffer com os bytes encriptados
      return safeStorage.decryptString(data);
    } else {
      // Fallback: decodifica base64
      return Buffer.from(data.toString('utf-8'), 'base64').toString('utf-8');
    }
  } catch {
    // Arquivo corrompido ou encriptado com outra conta — ignora e retorna null.
    return null;
  }
}

export function hasApiKey(): boolean {
  return existsSync(getKeyFilePath()) && loadApiKey() !== null;
}

export function deleteApiKey(): void {
  const filePath = getKeyFilePath();
  if (existsSync(filePath)) rmSync(filePath);
}
