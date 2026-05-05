import { embed } from './embedding.service';
import type { ExtractedConcept } from './prompts/quiz-analysis';

/*
  Clustering semântico de conceitos (v0.9.0+).

  Usado pelo pipeline de geração de quiz: depois da etapa 1 (análise) extrair
  uma lista plana de conceitos, agrupamos eles por similaridade semântica
  pra que a etapa 2 (geração) possa distribuir perguntas uniformemente
  entre clusters em vez de deixar o modelo escolher arbitrariamente.

  Pattern documentado em "Beyond prompt and pray" (47billion blog) —
  produção SOTA usa cluster semântico → quota fixa por cluster.

  Implementação: K-means simples em JavaScript puro. Sem dependência externa.
  - Embedding: reusa `embed()` do embedding.service (ONNX local, gratuito)
  - Inicialização: K-means++ (escolhe centroides bem espalhados pra
    evitar mínimos locais ruins)
  - Distância: cosine (1 - cos similarity). Embeddings BERT-style
    funcionam melhor com cosine que euclidean
  - Convergência: para quando centroides não mudam OU max 50 iterações
  - Determinístico: usa Math.random com seed fixo opcional pra testes
*/

export interface ConceptCluster {
  /** ID estável do cluster (c0, c1, c2…). Usado em prompts e logs. */
  id: string;
  /** Conceitos atribuídos a esse cluster. */
  concepts: ExtractedConcept[];
}

const MAX_ITERATIONS = 50;
const FLOOR_K = 3;
const CEIL_K = 12;

/**
 * Agrupa conceitos por similaridade semântica via K-means sobre embeddings.
 *
 * @param concepts Lista de conceitos da análise (etapa 1)
 * @param k Número de clusters. Default: ceil(sqrt(n_concepts)) com floor 3 e ceil 12
 * @returns Clusters não-vazios. Pode ter menos que k se a inicialização gerou
 *          centroides duplicados (raro). Pode retornar 1 só cluster com tudo
 *          se n_concepts < FLOOR_K (clustering não vale a pena).
 */
export async function clusterConcepts(
  concepts: ExtractedConcept[],
  k?: number,
): Promise<ConceptCluster[]> {
  const n = concepts.length;
  if (n === 0) return [];

  // Casos triviais: poucos conceitos não vale clusterizar
  if (n < FLOOR_K * 2) {
    return [{ id: 'c0', concepts: [...concepts] }];
  }

  const targetK = k ?? Math.min(CEIL_K, Math.max(FLOOR_K, Math.ceil(Math.sqrt(n))));

  // 1. Embedar todos os conceitos. Usa nome + definição pra texto rico.
  const vectors = await Promise.all(
    concepts.map(async (c) => {
      const text = `${c.name}: ${c.definition}`;
      const vec = await embed(text);
      return Array.from(vec);
    }),
  );

  // 2. Inicialização K-means++
  const centroids = kMeansPlusPlusInit(vectors, targetK);

  // 3. Iterações
  let assignments = new Array(n).fill(-1);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // 3a. Atribui cada vetor ao centroide mais próximo (cosine distance)
    const newAssignments: number[] = vectors.map((v) => nearestCentroid(v, centroids));

    // 3b. Verifica convergência
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed && iter > 0) break;

    // 3c. Recalcula centroides como média dos atribuídos
    for (let c = 0; c < targetK; c++) {
      const members = vectors.filter((_, i) => assignments[i] === c);
      if (members.length > 0) {
        centroids[c] = meanVector(members);
      }
      // Cluster vazio: mantém centroide antigo (raro, K-means++ minimiza)
    }
  }

  // 4. Monta resultado, descarta clusters vazios
  const buckets: ExtractedConcept[][] = Array.from({ length: targetK }, () => []);
  for (let i = 0; i < n; i++) {
    const slot = assignments[i] as number;
    buckets[slot]?.push(concepts[i]!);
  }

  return buckets
    .map((group, idx) => ({ id: `c${idx}`, concepts: group }))
    .filter((cluster) => cluster.concepts.length > 0);
}

// ── Implementação interna ────────────────────────────────────────────────

/**
 * K-means++: escolhe centroides iniciais bem espalhados.
 * Algoritmo: 1º centroide aleatório; cada centroide seguinte é escolhido
 * com probabilidade proporcional a D(x)² (distância ao centroide mais próximo).
 */
function kMeansPlusPlusInit(vectors: number[][], k: number): number[][] {
  if (vectors.length === 0) return [];
  const centroids: number[][] = [];

  // 1º: aleatório
  const firstIdx = Math.floor(Math.random() * vectors.length);
  centroids.push([...vectors[firstIdx]!]);

  // K-1 centroides adicionais
  for (let c = 1; c < k; c++) {
    const distances = vectors.map((v) => {
      let minDist = Infinity;
      for (const cent of centroids) {
        const d = cosineDistance(v, cent);
        if (d < minDist) minDist = d;
      }
      return minDist * minDist; // D(x)² weighting
    });

    const total = distances.reduce((s, d) => s + d, 0);
    if (total === 0) break; // todos os pontos iguais aos centroides

    let r = Math.random() * total;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i]!;
      if (r <= 0) {
        centroids.push([...vectors[i]!]);
        break;
      }
    }
  }

  return centroids;
}

function nearestCentroid(vector: number[], centroids: number[][]): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < centroids.length; i++) {
    const d = cosineDistance(vector, centroids[i]!);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function meanVector(vectors: number[][]): number[] {
  const dim = vectors[0]?.length ?? 0;
  const result = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      result[i] = (result[i] ?? 0) + (v[i] ?? 0);
    }
  }
  for (let i = 0; i < dim; i++) {
    result[i] = (result[i] ?? 0) / vectors.length;
  }
  return result;
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}
