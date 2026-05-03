import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIPC } from './useIPC';
import type { Quiz, QuizQuestion } from '@/types/ipc';

/*
  Estado da partida de quiz. Usado no QuizPlay.

  Fluxo de uma pergunta:
    1. Usuário clica numa opção (state: selectedIndex)
    2. Clica "Confirmar" → confirm() chama IPC `quizzes:answer` que persiste
       a resposta. Marca revealed=true → UI mostra explicação + cor das opções
       (correta verde / errada vermelha).
    3. Clica "Próxima" → next() avança índice e reseta selectedIndex/revealed.
       Se era a última, chama IPC `quizzes:finish` que calcula score final
       e marca finished=true.

  Após finished, a tela QuizResults consome o quiz via `quizzes.get(id)`
  (já tem todas as respostas salvas no DB).
*/
export function useQuizPlay(quiz: Quiz) {
  const api = useIPC();

  /*
    💡 Resume de partida em andamento. Se o usuário saiu no meio (botão "Sair"
    ou fechou o app), as respostas já dadas estão persistidas no DB. Ao voltar
    pra esse quiz, retomamos onde parou:

    - `currentIndex` = primeira pergunta sem resposta. Se todas têm resposta
      mas o quiz não está finalizado (caso raro), vai pra última.
    - `answers` reconstrói o histórico de respostas pra score correto.
  */
  const [currentIndex, setCurrentIndex] = useState(() => {
    const idx = quiz.questions.findIndex((q) => q.selectedIndex === null);
    return idx === -1 ? quiz.questions.length - 1 : idx;
  });
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Mapa local das respostas dadas. Inicializado com o que já foi respondido
   * (pra retomar partida em andamento). Atualizado após cada `confirm()`.
   */
  const [answers, setAnswers] = useState<
    Record<string, { selectedIndex: number; isCorrect: boolean }>
  >(() => {
    const initial: Record<string, { selectedIndex: number; isCorrect: boolean }> = {};
    for (const q of quiz.questions) {
      if (q.selectedIndex !== null && q.isCorrect !== null) {
        initial[q.id] = { selectedIndex: q.selectedIndex, isCorrect: q.isCorrect };
      }
    }
    return initial;
  });

  /*
    Tempo de início é capturado uma vez no mount. useState com função
    inicializadora garante que o valor não muda em re-renders.
  */
  const [startTime] = useState(() => Date.now());

  // Tempo decorrido em segundos (atualiza a cada segundo).
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (finished) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [finished, startTime]);

  const total = quiz.questions.length;
  const currentQuestion: QuizQuestion | undefined = quiz.questions[currentIndex];
  const isLast = currentIndex === total - 1;

  const score = useMemo(
    () => Object.values(answers).filter((a) => a.isCorrect).length,
    [answers],
  );

  const select = useCallback(
    (index: number) => {
      if (revealed || finished || submitting) return;
      setSelectedIndex(index);
    },
    [revealed, finished, submitting],
  );

  const confirm = useCallback(async () => {
    if (selectedIndex === null || revealed || !currentQuestion || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.quizzes.answer(currentQuestion.id, selectedIndex);
      setAnswers((prev) => ({
        ...prev,
        [currentQuestion.id]: {
          selectedIndex,
          isCorrect: updated.isCorrect === true,
        },
      }));
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [api, selectedIndex, revealed, currentQuestion, submitting]);

  const next = useCallback(async () => {
    if (!revealed || submitting) return;

    if (isLast) {
      // Última pergunta: finaliza o quiz.
      setSubmitting(true);
      try {
        await api.quizzes.finish(quiz.id, elapsedSeconds);
        setFinished(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    } else {
      // Avança e limpa estado da pergunta atual.
      setCurrentIndex((i) => i + 1);
      setSelectedIndex(null);
      setRevealed(false);
    }
  }, [api, revealed, isLast, quiz.id, elapsedSeconds, submitting]);

  return {
    // Estado
    currentIndex,
    currentQuestion,
    total,
    selectedIndex,
    revealed,
    finished,
    submitting,
    score,
    elapsedSeconds,
    isLast,
    error,
    answers,
    // Ações
    select,
    confirm,
    next,
  };
}
