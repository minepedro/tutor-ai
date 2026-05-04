import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Progress } from '@/components/ui/Progress';
import { QuizCard } from '@/components/quiz/QuizCard';
import { QuizOption } from '@/components/quiz/QuizOption';
import { QuizExplanation } from '@/components/quiz/QuizExplanation';
import { QuizDoubtChat } from '@/components/quiz/QuizDoubtChat';
import { useIPC } from '@/hooks/useIPC';
import { useQuizPlay } from '@/hooks/useQuizPlay';
import { quizResultsPath, ROUTES, topicViewPath } from '@/lib/constants';
import type { Quiz } from '@/types/ipc';

export function QuizPlay() {
  const api = useIPC();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined);

  // Carrega o quiz uma vez no mount.
  useEffect(() => {
    if (!id) {
      setQuiz(null);
      return;
    }
    let cancelled = false;
    void api.quizzes.get(id).then((q) => {
      if (cancelled) return;
      setQuiz(q);
      // Se o quiz já foi finalizado antes, vai direto pra results.
      if (q && q.completedAt !== null) {
        navigate(quizResultsPath(q.id), { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, id, navigate]);

  // ── Estados de carregamento ────────────────────────────────────────────
  if (quiz === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando…" />
      </div>
    );
  }

  if (quiz === null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Quiz não encontrado" />
        <main className="flex flex-1 items-center justify-center p-8">
          <Button variant="secondary" onClick={() => navigate(ROUTES.HOME)}>
            ← Voltar
          </Button>
        </main>
      </div>
    );
  }

  // Se já completedAt, redirect já disparou no useEffect; renderiza loading.
  if (quiz.completedAt !== null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando…" />
      </div>
    );
  }

  return <QuizPlayInner quiz={quiz} />;
}

/*
  Componente interno depois que o quiz está garantido.
  Separado pra que o `useQuizPlay` (que usa `quiz` como dep) só rode quando
  o quiz tem dado válido — evita estados intermediários no hook.
*/
interface InnerProps {
  quiz: Quiz;
}

function QuizPlayInner({ quiz }: InnerProps) {
  const navigate = useNavigate();
  const play = useQuizPlay(quiz);
  const [doubtOpen, setDoubtOpen] = useState(false);

  // Quando o hook marca finished, navega pros resultados.
  useEffect(() => {
    if (play.finished) {
      navigate(quizResultsPath(quiz.id), { replace: true });
    }
  }, [play.finished, navigate, quiz.id]);

  const { currentQuestion, currentIndex, total, revealed, selectedIndex } = play;

  // Fecha o painel de dúvidas ao trocar de pergunta — cada pergunta tem sua
  // própria conversa, abrir manualmente força o aluno a tomar a decisão de
  // estudar essa pergunta nova.
  useEffect(() => {
    setDoubtOpen(false);
  }, [currentQuestion?.id]);

  if (!currentQuestion) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando pergunta…" />
      </div>
    );
  }

  // Determina o estado visual de cada opção
  function optionState(optIndex: number): 'correct' | 'wrong' | 'idle' | undefined {
    if (!revealed) return undefined;
    if (optIndex === currentQuestion!.correctIndex) return 'correct';
    if (optIndex === selectedIndex) return 'wrong';
    return 'idle';
  }

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title={quiz.title ?? 'Quiz'}
        subtitle={`${play.score} acertos · ${formatTime(play.elapsedSeconds)}`}
      />

      <main className="flex flex-1 flex-col gap-6 p-8 pb-24">
        {/* Botão "Sair" — quiz pausa, respostas dadas ficam salvas */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(topicViewPath(quiz.topicId))}
          >
            ← Sair (continua depois)
          </Button>
          <span className="font-sans text-xs text-text-subtle">
            Suas respostas são salvas a cada confirmação
          </span>
        </div>

        {/* Barra de progresso global */}
        <Progress value={(currentIndex / total) * 100} />

        {/* Card da pergunta */}
        <Card className="flex flex-col gap-6">
          <QuizCard
            question={currentQuestion}
            index={currentIndex + 1}
            total={total}
          />

          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt, i) => (
              <QuizOption
                key={i}
                index={i}
                text={opt}
                selected={selectedIndex === i}
                state={optionState(i)}
                disabled={revealed || play.submitting}
                onClick={() => play.select(i)}
              />
            ))}
          </div>

          {/* Explicação aparece após confirmar */}
          {revealed && (
            <QuizExplanation
              isCorrect={selectedIndex === currentQuestion.correctIndex}
              explanation={currentQuestion.explanation}
            />
          )}

          {play.error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 font-sans text-sm text-danger">
              {play.error}
            </div>
          )}

          {/* Ações + tirar dúvida */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDoubtOpen((v) => !v)}
            >
              💬 {doubtOpen ? 'Fechar dúvidas' : 'Tirar dúvida'}
            </Button>
            {!revealed ? (
              <Button
                onClick={play.confirm}
                disabled={selectedIndex === null || play.submitting}
                loading={play.submitting}
              >
                Confirmar resposta
              </Button>
            ) : (
              <Button onClick={play.next} loading={play.submitting}>
                {play.isLast ? 'Ver resultado →' : 'Próxima pergunta →'}
              </Button>
            )}
          </div>
        </Card>

        {/* Chat de dúvidas inline (colapsável) */}
        {doubtOpen && currentQuestion && (
          <Card className="overflow-hidden p-0">
            <QuizDoubtChat
              quizQuestionId={currentQuestion.id}
              state={
                !revealed
                  ? 'unanswered'
                  : selectedIndex === currentQuestion.correctIndex
                    ? 'correct'
                    : 'wrong'
              }
            />
          </Card>
        )}
      </main>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
