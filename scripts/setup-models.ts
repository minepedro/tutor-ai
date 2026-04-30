/**
 * Script standalone: baixa o modelo all-MiniLM-L6-v2 da HuggingFace.
 * Pode ser rodado manualmente com: npm run setup-models
 *
 * A mesma lógica de download é chamada via IPC no Onboarding (Fase G).
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { get } from 'node:https';

const MODEL_DIR = join(process.cwd(), 'models');
const MODEL_FILE = join(MODEL_DIR, 'all-MiniLM-L6-v2.onnx');

// Modelo exportado para ONNX pela comunidade — mesmo arquivo usado pelo
// sentence-transformers, ampla adoção em projetos de embeddings locais.
const MODEL_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';

async function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);

    const request = get(url, (res) => {
      // Segue redirects (HuggingFace usa redirects)
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers['location'];
        if (!location) return reject(new Error('Redirect sem Location header'));
        file.close();
        download(location, dest).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] ?? '0', 10);
      let downloaded = 0;

      res.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.round((downloaded / total) * 100);
          process.stdout.write(`\r  Baixando… ${pct}% (${(downloaded / 1e6).toFixed(1)} MB)`);
        }
      });

      pipeline(res, file)
        .then(() => {
          process.stdout.write('\n');
          resolve();
        })
        .catch(reject);
    });

    request.on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

async function main(): Promise<void> {
  if (!existsSync(MODEL_DIR)) {
    mkdirSync(MODEL_DIR, { recursive: true });
  }

  if (existsSync(MODEL_FILE)) {
    console.log('✓ Modelo já existe em:', MODEL_FILE);
    return;
  }

  console.log('Baixando all-MiniLM-L6-v2 (~30 MB)…');
  console.log('Destino:', MODEL_FILE);

  await download(MODEL_URL, MODEL_FILE);
  console.log('✓ Download concluído!');
}

main().catch((err: unknown) => {
  console.error('Erro:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
