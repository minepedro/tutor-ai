import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import type { PreTrainedTokenizer } from '@xenova/transformers';

/*
  Embeddings semânticos com all-MiniLM-L6-v2 (BERT-style, 384 dims).

  Decisão (v0.2.0 — Fase F.5):
  - Tokenizer: `@xenova/transformers` (AutoTokenizer.from_pretrained), que carrega
    o tokenizer.json oficial do BERT-base. Garante que os IDs de token batem com
    o vocabulário usado no treino do modelo — pré-requisito para embeddings
    semanticamente válidos.
  - Inferência: `onnxruntime-node` direto (não a pipeline do transformers.js),
    pra reaproveitar o modelo .onnx já baixado pelo nosso fluxo de Onboarding.

  💡 Por que dynamic import? `@xenova/transformers` é publicado como ESM-only.
  O main process do Electron é bundleado como CommonJS por padrão — `require()`
  de um módulo ESM lança ERR_REQUIRE_ESM. `import()` (com parênteses) funciona
  em ambos os formatos porque é uma chamada assíncrona que respeita ESM.

  Cache do tokenizer: `<userDataPath>/models/transformers-cache/`. Os arquivos do
  tokenizer (~1MB) são baixados na primeira chamada, depois reutilizados.

  v0.7.2: service plataforma-agnóstico. Caller injeta `userDataPath` via
  `configureEmbeddingService()` ANTES da primeira chamada. Sem imports de
  Electron aqui — quando virar web, troca pela path equivalente.
*/

const TOKENIZER_REPO = 'Xenova/all-MiniLM-L6-v2';
const MAX_SEQ_LEN = 256; // limite interno do all-MiniLM-L6-v2
const HIDDEN_SIZE = 384;

let session: ort.InferenceSession | null = null;
let tokenizer: PreTrainedTokenizer | null = null;
let transformersConfigured = false;
let userDataPath: string | null = null;

export function configureEmbeddingService(path: string): void {
  userDataPath = path;
}

function requirePath(): string {
  if (!userDataPath) {
    throw new Error(
      'embedding.service não configurado. Chame configureEmbeddingService() no boot.',
    );
  }
  return userDataPath;
}

export function getModelPath(): string {
  return join(requirePath(), 'models', 'all-MiniLM-L6-v2.onnx');
}

export function isModelReady(): boolean {
  return existsSync(getModelPath());
}

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;

  const modelPath = getModelPath();
  if (!existsSync(modelPath)) {
    throw new Error(
      `Modelo ONNX não encontrado em ${modelPath}. Execute "npm run setup-models".`,
    );
  }

  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
  });

  return session;
}

async function getTokenizer(): Promise<PreTrainedTokenizer> {
  if (tokenizer) return tokenizer;

  // Dynamic import (ver comentário no topo do arquivo).
  const transformers = await import('@xenova/transformers');

  if (!transformersConfigured) {
    transformers.env.cacheDir = join(
      requirePath(),
      'models',
      'transformers-cache',
    );
    transformers.env.allowLocalModels = false;
    transformersConfigured = true;
  }

  tokenizer = await transformers.AutoTokenizer.from_pretrained(TOKENIZER_REPO);
  return tokenizer;
}

/**
 * Gera um embedding de 384 dimensões para o texto de entrada.
 * O modelo all-MiniLM-L6-v2 trunca em 256 tokens — textos maiores são cortados
 * automaticamente pelo tokenizer (não erra, mas perde a parte além do limite).
 */
export async function embed(text: string): Promise<Float32Array> {
  const sess = await getSession();
  const tok = await getTokenizer();

  /*
    O tokenizer retorna BatchEncoding com `input_ids`, `attention_mask` e
    `token_type_ids` (para BERT) como tensores. `.data` é o BigInt64Array
    subjacente, formato esperado pelo onnxruntime-node em tensores 'int64'.
  */
  const encoded = await tok(text, {
    padding: true,
    truncation: true,
    max_length: MAX_SEQ_LEN,
  });

  const inputIds = encoded.input_ids.data as BigInt64Array;
  const attentionMask = encoded.attention_mask.data as BigInt64Array;
  const seqLen = encoded.input_ids.dims[1] ?? inputIds.length;
  const tokenTypeIds = new BigInt64Array(seqLen).fill(0n);

  const feeds = {
    input_ids: new ort.Tensor('int64', inputIds, [1, seqLen]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, seqLen]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, seqLen]),
  };

  const results = await sess.run(feeds);

  // all-MiniLM-L6-v2 retorna 'last_hidden_state' [1, seqLen, 384] — fazemos
  // mean pooling ponderado pelo attention_mask (ignora tokens de padding).
  const hiddenState = results['last_hidden_state'];
  if (!hiddenState) throw new Error('Output "last_hidden_state" não encontrado');

  return meanPoolMasked(
    hiddenState.data as Float32Array,
    attentionMask,
    seqLen,
    HIDDEN_SIZE,
  );
}

/*
  Mean pooling com máscara: soma só as posições onde attention_mask = 1
  (tokens reais) e divide pelo número de tokens reais. Sem isso, os tokens
  de padding (PAD = 0) "puxam" o vetor pra zero proporcional ao quanto
  da sequência foi padding.
*/
function meanPoolMasked(
  data: Float32Array,
  attentionMask: BigInt64Array,
  seqLen: number,
  hiddenSize: number,
): Float32Array {
  const result = new Float32Array(hiddenSize);
  let activeTokens = 0;

  for (let i = 0; i < seqLen; i++) {
    const mask = Number(attentionMask[i] ?? 0n);
    if (mask === 0) continue; // pula padding
    activeTokens++;
    for (let j = 0; j < hiddenSize; j++) {
      result[j] = (result[j] ?? 0) + (data[i * hiddenSize + j] ?? 0);
    }
  }

  if (activeTokens === 0) return result; // edge case: input vazio
  for (let j = 0; j < hiddenSize; j++) {
    result[j] = (result[j] ?? 0) / activeTokens;
  }
  return result;
}
