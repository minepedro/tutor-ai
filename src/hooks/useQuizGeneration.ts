import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type {
  GenerateQuizInput,
  GenerateQuizResult,
  QuizGenerationProgress,
} from '@/types/ipc';

/*
  Hook pro fluxo de geração de quiz. Usado no QuizSetup.

  Responsabilidades:
  - Chamar `quizzes.generate(input)` e retornar o quiz quando pronto
  - Subscrever a progresso (que chega via webContents.send no main → ipcRenderer.on no preload → callback aqui)
  - Estado de loading/erro pra UI mostrar
  - Botão "Sugerir temas" também vive aqui (chama `suggestThemes`)
*/
export function useQuizGeneration() {
  const api = useIPC();
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<QuizGenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscreve eventos de progresso. Cleanup ao desmontar.
  useEffect(() => {
    const unsubscribe = api.quizzes.onProgress((event) => {
      setProgress(event);
    });
    return unsubscribe;
  }, [api]);

  /**
   * Gera o quiz. Retorna o resultado completo (quiz + estatísticas + flag
   * themeMatched). UI deve verificar `themeMatched` antes de navegar:
   * se false, mostra mensagem "tema não encontrado no material".
   */
  const generate = useCallback(
    async (input: GenerateQuizInput): Promise<GenerateQuizResult | null> => {
      setGenerating(true);
      setError(null);
      setProgress({ pct: 0, status: 'Iniciando…' });
      try {
        return await api.quizzes.generate(input);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setGenerating(false);
        setProgress(null);
      }
    },
    [api],
  );

  /**
   * Pede temas sugeridos baseados no material. Reaproveita cache de análise
   * em sources.extracted_concepts (na primeira chamada custa 1 chamada à API
   * por source não-cacheada; nas próximas é instantâneo).
   */
  const suggestThemes = useCallback(
    async (sourceIds: string[]): Promise<string[]> => {
      try {
        return await api.quizzes.suggestThemes(sourceIds);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      }
    },
    [api],
  );

  return { generating, progress, error, generate, suggestThemes };
}
