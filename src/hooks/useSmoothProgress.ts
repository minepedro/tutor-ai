import { useEffect, useRef, useState } from 'react';

/*
  Interpolação visual de progresso (v0.8.5+).

  Problema original: backend reporta progresso em saltos discretos
  (ex: 5% → 30% → 35% → 75% → 100%). Barra fica parada por 10-20s entre
  saltos, dando sensação de "travado".

  Solução: entre cada checkpoint REAL recebido do backend, interpolamos
  visualmente em direção ao próximo ceiling estimado, com curva ease-out
  (rápida no início, desacelera). Nunca ultrapassa o ceiling antes do
  backend mandar update real, evitando "voltar" se o pipeline for mais
  rápido que o esperado.

  v0.8.6: 2 correções importantes:
  1. **Math.max** em todo setDisplayPct: barra NUNCA volta. React strict
     mode (em dev) e re-renders podem disparar useEffect 2x com mesmo
     realPct — sem o Math.max, o snap pra realPct (menor que display
     interpolado) fazia a barra voltar.
  2. **Backend agora reporta progresso GRANULAR** durante análise paralela
     (1 update por source que completa). Isso resolve o caso de "muitos
     PDFs travados em 28%": agora a barra avança a cada source completada,
     em vez de ficar esperando todos.

  Estágios continuam aqui pra cobrir os gaps que ainda existem (35→75
  durante geração, 75→100 durante validação). Quando backend mandar updates
  intermediários, o snap atualiza e o ceiling pode ser ajustado.
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
  // Etapa 1: análise (a partir de v0.8.6 o backend já reporta progress
  // granular entre 5%-28%; o stage aqui é fallback caso só venha 1 update).
  { fromPct: 5, ceilingPct: 28, durationMs: 12_000 },
  { fromPct: 30, ceilingPct: 33, durationMs: 1_000 },
  // Etapa 2: geração (35 → 70 em ~18s, etapa mais longa, sem updates intermediários)
  { fromPct: 35, ceilingPct: 70, durationMs: 18_000 },
  // Etapa 3: validação (75 → 95 em ~6s; com Haiku 4.5 desde v0.8.4)
  { fromPct: 75, ceilingPct: 95, durationMs: 6_000 },
];

const TICK_MS = 100;

/**
 * Pega o pct real do backend e retorna um pct visual interpolado.
 * Garante que a barra NUNCA regride — `Math.max` em todos os updates.
 *
 * Pass `null` quando não está rodando — reseta o estado interno pra 0.
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

    // Snap pra realPct, MAS nunca volta. Defesa contra:
    // - StrictMode em dev rodando effect 2x
    // - Backend mandando updates fora de ordem (Promise.all paralelo)
    // - Re-render por outro motivo
    setDisplayPct((prev) => Math.max(prev, realPct));

    if (realPct >= 100) return;

    // Acha estágio compatível pra interpolação. Se não tiver match exato
    // (porque backend agora manda valores intermediários como 9%, 12%, 17%...),
    // achar o estágio CUJO range cobre o realPct atual.
    const stage =
      QUIZ_STAGES.find((s) => s.fromPct === realPct) ??
      QUIZ_STAGES.find((s) => realPct > s.fromPct && realPct < s.ceilingPct);
    if (!stage) return;

    const startTime = Date.now();
    const startPct = realPct;
    const span = stage.ceilingPct - startPct;
    if (span <= 0) return;

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const fraction = Math.min(1, elapsed / stage.durationMs);
      const eased = 1 - Math.pow(1 - fraction, 2);
      const interpolated = startPct + span * eased;
      setDisplayPct((prev) => Math.max(prev, interpolated));
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
