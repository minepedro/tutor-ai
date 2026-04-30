import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';

/*
  Singleton: carrega o modelo ONNX uma única vez no processo main.
  Chamadas subsequentes a embed() reutilizam a sessão já aberta.
*/
let session: ort.InferenceSession | null = null;

export function getModelPath(): string {
  return join(app.getPath('userData'), 'models', 'all-MiniLM-L6-v2.onnx');
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

/**
 * Gera um embedding de 384 dimensões para o texto de entrada.
 * O modelo all-MiniLM-L6-v2 aceita no máximo ~512 tokens — textos muito longos
 * devem ser chunked antes de chamar embed().
 */
export async function embed(text: string): Promise<Float32Array> {
  const sess = await getSession();

  // Tokenização simplificada: whitespace split + padding para 128 tokens.
  // Para produção (v0.2.0+) usar o tokenizer oficial via @xenova/transformers
  // ou tokenizers-node, que respeita o vocabulário exato do modelo.
  const tokens = tokenize(text);
  const inputIds = new BigInt64Array(tokens.map(BigInt));
  const attentionMask = new BigInt64Array(tokens.map(() => 1n));
  const tokenTypeIds = new BigInt64Array(tokens.map(() => 0n));

  const feeds = {
    input_ids: new ort.Tensor('int64', inputIds, [1, tokens.length]),
    attention_mask: new ort.Tensor('int64', attentionMask, [1, tokens.length]),
    token_type_ids: new ort.Tensor('int64', tokenTypeIds, [1, tokens.length]),
  };

  const results = await sess.run(feeds);

  // all-MiniLM-L6-v2 retorna 'last_hidden_state' — fazemos mean pooling
  const hiddenState = results['last_hidden_state'];
  if (!hiddenState) throw new Error('Output "last_hidden_state" não encontrado');

  return meanPool(hiddenState.data as Float32Array, tokens.length, 384);
}

/** Tokenização básica por whitespace + IDs sintéticos. Suficiente para v0.1.0. */
function tokenize(text: string, maxLength = 128): number[] {
  const CLS = 101;
  const SEP = 102;
  const PAD = 0;

  const words = text.toLowerCase().trim().split(/\s+/).slice(0, maxLength - 2);
  // Hash simples: soma dos char codes mod vocabulário (30522 tokens do BERT-base)
  const wordIds = words.map((w) =>
    (w.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 30000) + 100,
  );

  const ids = [CLS, ...wordIds, SEP];
  while (ids.length < maxLength) ids.push(PAD);
  return ids.slice(0, maxLength);
}

/** Mean pooling sobre a dimensão de sequência. */
function meanPool(data: Float32Array, seqLen: number, hiddenSize: number): Float32Array {
  // 💡 noUncheckedIndexedAccess força tratar acessos por índice como possivelmente
  // undefined. Float32Array é zero-initialized, então `?? 0` é apenas para o tipo.
  const result = new Float32Array(hiddenSize);
  for (let i = 0; i < seqLen; i++) {
    for (let j = 0; j < hiddenSize; j++) {
      result[j] = (result[j] ?? 0) + (data[i * hiddenSize + j] ?? 0);
    }
  }
  for (let j = 0; j < hiddenSize; j++) {
    result[j] = (result[j] ?? 0) / seqLen;
  }
  return result;
}
