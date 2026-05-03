import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { QuizOption } from '@/components/quiz/QuizOption';
import { useIPC } from '@/hooks/useIPC';
import { quizPlayPath, quizSetupPath, ROUTES, topicViewPath } from '@/lib/constants';
import type { Quiz, QuizQuestion } from '@/types/ipc';

export function QuizResults() {
  const api = useIPC();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [quiz, setQuiz] = useState<Quiz | null | undefined>(undefined);
  const [resetting, setResetting] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!quiz) return;
    setDeleting(true);
    try {
      await api.quizzes.delete(quiz.id);
      navigate(topicViewPath(quiz.topicId), { replace: true });
    } catch (err) {
      console.error('Falha ao excluir quiz:', err);
      setDeleting(false);
    }
  }

  async function handleReset() {
    if (!quiz) return;
    setResetting(true);
    try {
      await api.quizzes.reset(quiz.id);
      navigate(quizPlayPath(quiz.id));
    } catch (err) {
      console.error('Falha ao refazer quiz:', err);
      setResetting(false);
    }
  }

  function openRename() {
    if (!quiz) return;
    setNewTitle(quiz.title ?? '');
    setRenameError('');
    setRenameOpen(true);
  }

  async function handleRename() {
    if (!quiz) return;
    const trimmed = newTitle.trim();
    if (trimmed.length === 0) {
      setRenameError('Título não pode ficar vazio.');
      return;
    }
    setRenaming(true);
    try {
      const updated = await api.quizzes.rename(quiz.id, trimmed);
      setQuiz(updated);
      setRenameOpen(false);
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  }

  useEffect(() => {
    if (!id) {
      setQuiz(null);
      return;
    }
    let cancelled = false;
    void api.quizzes.get(id).then((q) => {
      if (!cancelled) setQuiz(q);
    });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  // ── Estados de carregamento ────────────────────────────────────────────
  if (quiz === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando resultado…" />
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

  const score = quiz.score ?? 0;
  const total = quiz.totalQuestions;
  const percent = Math.round((score / total) * 100);
  const correctIds = new Set(
    quiz.questions.filter((q) => q.isCorrect === true).map((q) => q.id),
  );
  const wrongQuestions = quiz.questions.filter((q) => q.isCorrect === false);

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title="Resultado"
        subtitle={`${score}/${total} acertos · ${formatTime(quiz.timeSpentSeconds ?? 0)}`}
      />

      <main className="flex flex-1 flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(topicViewPath(quiz.topicId))}
          >
            ← Voltar ao tópico
          </Button>
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              🗑️ Excluir
            </Button>
            <Button
              variant="secondary"
              onClick={handleReset}
              loading={resetting}
              disabled={resetting}
            >
              ↻ Refazer este quiz
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(quizSetupPath(quiz.topicId))}
            >
              Gerar novo quiz
            </Button>
          </div>
        </div>

        {/* Resumo grande do resultado */}
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-6xl">{getEmoji(percent)}</p>
          <p className="font-sans text-4xl font-bold text-text">
            {score}
            <span className="text-text-muted">/{total}</span>
          </p>
          <p className="font-sans text-sm text-text-muted">{percent}% de acerto</p>

          {/* Título do quiz com botão de renomear (sempre visível) */}
          <div className="mt-4 flex items-center gap-2">
            <p
              className={[
                'font-sans text-sm',
                quiz.title
                  ? 'font-medium text-text'
                  : 'italic text-text-subtle',
              ].join(' ')}
            >
              {quiz.title ?? 'Sem título'}
            </p>
            <button
              type="button"
              onClick={openRename}
              aria-label="Renomear quiz"
              className="text-text-subtle transition-colors hover:text-accent"
            >
              ✏️
            </button>
          </div>

          <p className="mt-2 max-w-md font-sans text-sm text-text-muted">
            {getMessage(percent)}
          </p>
        </Card>

        {/* Perguntas erradas (revisão) */}
        {wrongQuestions.length > 0 && (
          <div className="flex flex-col gap-3">
            <h2 className="font-sans text-base font-semibold text-text">
              {wrongQuestions.length === 1
                ? 'Revisão da pergunta errada'
                : `Revisão das ${wrongQuestions.length} perguntas erradas`}
            </h2>
            {wrongQuestions.map((q, i) => (
              <ReviewItem key={q.id} question={q} indexInWrong={i + 1} />
            ))}
          </div>
        )}

        {/* Perguntas certas (collapsed/resumida) */}
        {correctIds.size > 0 && wrongQuestions.length > 0 && (
          <details className="rounded-[10px] border border-border bg-bg-elevated">
            <summary className="cursor-pointer px-4 py-3 font-sans text-sm font-medium text-text-muted hover:text-text">
              Ver as {correctIds.size}{' '}
              {correctIds.size === 1 ? 'que você acertou' : 'que você acertou'}
            </summary>
            <div className="flex flex-col gap-3 border-t border-border p-4">
              {quiz.questions
                .filter((q) => q.isCorrect === true)
                .map((q, i) => (
                  <ReviewItem key={q.id} question={q} indexInWrong={i + 1} />
                ))}
            </div>
          </details>
        )}

        {/* Caso 100% acerto: celebração curta sem revisão */}
        {wrongQuestions.length === 0 && (
          <Card className="text-center">
            <p className="font-sans text-sm text-text-muted">
              Acertou tudo! 🎉 Sem perguntas pra revisar.
            </p>
          </Card>
        )}
      </main>

      {/* Modal de renomear */}
      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Renomear quiz"
        confirmLabel="Salvar"
        onConfirm={handleRename}
        confirmLoading={renaming}
      >
        <Input
          label="Novo título"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          error={renameError}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRename();
          }}
        />
      </Modal>

      {/* Modal de excluir */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={`Excluir "${quiz.title ?? 'este quiz'}"?`}
        confirmLabel="Excluir"
        confirmVariant="danger"
        onConfirm={handleDelete}
        confirmLoading={deleting}
      >
        <p>
          O quiz e todas as perguntas/respostas dele serão apagados.
          Esta ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
  );
}

interface ReviewItemProps {
  question: QuizQuestion;
  indexInWrong: number;
}

function ReviewItem({ question, indexInWrong }: ReviewItemProps) {
  function optionState(i: number): 'correct' | 'wrong' | 'idle' {
    if (i === question.correctIndex) return 'correct';
    if (i === question.selectedIndex) return 'wrong';
    return 'idle';
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="rounded-full bg-surface px-2 py-0.5 font-sans text-xs text-text-muted">
          {indexInWrong}
        </span>
        <p className="flex-1 font-sans text-sm font-medium leading-relaxed text-text">
          {question.question}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {question.options.map((opt, i) => (
          <QuizOption
            key={i}
            index={i}
            text={opt}
            selected={false}
            state={optionState(i)}
            disabled={true}
            onClick={() => {}}
          />
        ))}
      </div>

      <div className="rounded-md border border-border bg-surface px-3 py-2">
        <p className="mb-1 font-sans text-xs font-semibold text-text-muted">
          Explicação
        </p>
        <p className="font-sans text-xs leading-relaxed text-text">
          {question.explanation}
        </p>
      </div>
    </Card>
  );
}

function getEmoji(percent: number): string {
  if (percent === 100) return '🏆';
  if (percent >= 80) return '🌟';
  if (percent >= 60) return '👍';
  if (percent >= 40) return '🤔';
  return '📚';
}

function getMessage(percent: number): string {
  if (percent === 100) return 'Mandou bem! Você dominou esse material.';
  if (percent >= 80) return 'Ótimo desempenho. Quase tudo certo.';
  if (percent >= 60) return 'Bom resultado. Revise os erros pra fixar melhor.';
  if (percent >= 40)
    return 'Tem espaço pra melhorar. Vale revisar o material e tentar de novo.';
  return 'Esse tópico precisa de mais estudo. Releia o material e gere outro quiz.';
}

function formatTime(totalSeconds: number): string {
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}
