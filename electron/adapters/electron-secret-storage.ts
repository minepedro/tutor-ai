import { safeStorage } from 'electron';
import type { SecretStorage } from '../utils/crypto';

/*
  Adapter Electron pra interface SecretStorage definida em utils/crypto.ts.

  Este é o ÚNICO lugar fora de `main.ts`/`preload.ts`/`ipc/*.ts` que pode
  importar de `'electron'`. Documentado como exceção legítima em ADR-038.

  Plataformas suportadas pelo `safeStorage`:
  - Windows: DPAPI (vinculado ao usuário do Windows)
  - macOS: Keychain
  - Linux: libsecret/kwallet (se disponível)
  - Linux sem keyring: retorna `false` em isAvailable() → caller cai no fallback
*/

export class ElectronSafeStorage implements SecretStorage {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  encrypt(plaintext: string): Buffer | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(plaintext);
  }

  decrypt(cipher: Buffer): string | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(cipher);
    } catch {
      return null;
    }
  }
}
