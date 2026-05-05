import { useEffect, useRef, useState } from 'react';

/*
  Interpolação visual de progresso (v0.8.5+).

  Problema: o backend reporta progresso em saltos discretos (ex: 5% → 30% →
  35% → 75% → 100%). A barra fica parada por 10-20s entre saltos, dando
  sensação de "travado". UX ruim mesmo quando o pipeline está rodando.

  Solução: entre cada checkpoint REAL recebido do backend, interpolamos
  visualmente em direção ao próximo checkpoint estimado, usando duração
  empírica de cada estágio. Curva ease-out (rápida no início, desacelera) —
  garante que NUNCA chega no próximo ceiling antes do backend mandar o
  update real, evitando "ultrapassar" e ter que voltar.

  Estratégia:
  - Recebeu valor X → snap visual pra X
  - Próximo ceiling Y conhecido → interpola X → Y durante `durationMs`
  - Quando o backend manda Y de verdade → snap pra Y, repete pro próximo
  - Se backend manda valor maior que o display atual → snap (acelera)
  - Se backend manda valor menor (improvável) → snap também (consistência)

  Usado pra geração de quiz onde temos checkpoints conhecidos:
  - 5% (análise inicia) → ceiling 28% em ~12s
  - 30% (análise completa) → ceiling 33% em ~1s
  - 35% (geração inicia) → ceiling 70% em ~18s
  - 75% (validação inicia) → ceiling 95% em ~6s
  - 100% (fim) → snap
*/

interface Stage {
  /** Valor recebido do backend que dispara essa interpolação. */
  fromPct: number;
  /** Ceiling visual — nunca passa disso até o próximo checkpoint real. */
  ceilingPct: number;
  /** Duração estimada da etapa pra ease-out chegar perto do ceiling. */
  durationMs: number;
}

const QUIZ_STAGES: Stage[] = [
  // Etapa 1: análise (5 → 28% em ~12s; 30 = "completa", quase instantâneo)
  { fromPct: 5, ceilingPct: 28, durationMs: 12_000 },
  { fromPct: 30, ceilingPct: 33, durationMs: 1_000 },
  // Etapa 2: geração (35 → 70 em ~18s, etapa mais longa)
  { fromPct: 35, ceilingPct: 70, durationMs: 18_000 },
  // Etapa 3: validação (75 → 95 em ~6s)
  { fromPct: 75, ceilingPct: 95, durationMs: 6_000 },
];

const TICK_MS = 100;

/**
 * Pega o pct real do backend e retorna um pct visual interpolado.
 * Quando o backend dá saltos longos, a barra continua se mexendo em
 * direção ao próximo ceiling estimado. Ease-out evita ultrapassar.
 *
 * Pass `null` ou pct=0 quando não está rodando — reseta o estado interno.
 */
export function useSmoothProgress(realPct: number | null): number {
  const [displayPct, setDisplayPct] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Cleanup do interval anterior
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (realPct === null) {
      setDisplayPct(0);
      return;
    }

    // Snap visual pra valor real (subindo OU descendo — consistência)
    setDisplayPct(realPct);

    // 100% → fim, sem mais interpolação
    if (realPct >= 100) return;

    // Acha estágio compatível pra interpolar
    const stage = QUIZ_STAGES.find((s) => s.fromPct === realPct);
    if (!stage) return;

    const startTime = Date.now();
    const startPct = realPct;
    const span = stage.ceilingPct - startPct;

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const fraction = Math.min(1, elapsed / stage.durationMs);
      // Ease-out: 1 - (1-x)^2 — começa rápido, desacelera. Garante que se
      // aproxima do ceiling sem nunca atingi-lo antes do backend mandar update.
      const eased = 1 - Math.pow(1 - fraction, 2);
      const interpolated = startPct + span * eased;
      setDisplayPct(interpolated);
      if (fraction >= 1 && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, TICK_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [realPct]);

  return Math.round(displayPct);
}
