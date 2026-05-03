import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useIPC } from '@/hooks/useIPC';
import { quizPlayPath, quizResultsPath } from '@/lib/constants';
import type { QuizSummary } from '@/types/ipc';

interface Props {
  topicId: string;
}

/*
  Lista os quizzes de um tópico. Cada item tem ações de hover (renomear,
  excluir) e clique direto navega pra play (em andamento) ou results
  (finalizado).

  Renomear/excluir vivem aqui (1 lugar) com modais internos. Após cada
  ação, refaz o fetch pra refletir mudança imediatamente.
*/
export function QuizHistoryList({ topicId }: Props) {
  const api = useIPC();
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [loading, setLoading] = useState(true);

  // Estado dos modais (renomear/excluir)
  const [renameTarget, setRenameTarget] = useState<QuizSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<QuizSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.quizzes.listByTopic(topicId);
      setQuizzes(list);
    } finally {
      setLoading(false);
    }
  }, [api, topicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openRename(quiz: QuizSummary) {
    setRenameTarget(quiz);
    setRenameValue(quiz.title ?? '');
    setRenameError('');
  }

  async function handleRename() {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      setRenameError('Título não pode ficar vazio.');
      return;
    }
    setRenaming(true);
    try {
      await api.quizzes.rename(renameTarget.id, trimmed);
      setRenameTarget(null);
      await refresh();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenaming(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.quizzes.delete(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return null;
  if (quizzes.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-sans text-sm font-medium text-text-muted">
        Quizzes anteriores ({quizzes.length})
      </h3>
      <div className="flex flex-col gap-2">
        {quizzes.map((q) => (
          <QuizHistoryItem
            key={q.id}
            quiz={q}
            onClick={() =>
              q.completedAt !== null
                ? navigate(quizResultsPath(q.id))
                : navigate(quizPlayPath(q.id))
            }
            onRename={() => openRename(q)}
            onDelete={() => setDeleteTarget(q)}
          />
        ))}
      </div>

      {/* Modal de renomear */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Renomear quiz"
        confirmLabel="Salvar"
        onConfirm={handleRename}
        confirmLoading={renaming}
      >
        <Input
          label="Novo título"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          error={renameError}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRename();
          }}
        />
      </Modal>

      {/* Modal de excluir */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Excluir "${deleteTarget?.title ?? 'este quiz'}"?`}
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

interface ItemProps {
  quiz: QuizSummary;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function QuizHistoryItem({ quiz, onClick, onRename, onDelete }: ItemProps) {
  const completed = quiz.completedAt !== null;
  const score = quiz.score ?? 0;
  const percent = completed ? Math.round((score / quiz.totalQuestions) * 100) : null;

  return (
    <div
      className={[
        'group flex items-center gap-3 rounded-[10px] border border-border bg-bg-elevated',
        'px-4 py-3 transition-colors',
        'hover:border-accent/40 hover:bg-surface',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <span className="text-xl">{completed ? '🎯' : '⏸️'}</span>

        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-sm font-medium text-text">
            {quiz.title ?? `Quiz de ${formatDate(quiz.createdAt)}`}
          </p>
          <p className="font-sans text-xs text-text-subtle">
            {completed ? (
              <>
                {score}/{quiz.totalQuestions} acertos · {percent}%
              </>
            ) : (
              <>{quiz.totalQuestions} perguntas · em andamento</>
            )}{' '}
            · {formatDate(quiz.createdAt)}
          </p>
        </div>

        {completed && percent !== null && <ScoreBadge percent={percent} />}
      </button>

      {/* Ações de hover */}
      <div className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <IconButton
          label="Renomear quiz"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          ✏️
        </IconButton>
        <IconButton
          label="Excluir quiz"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          🗑️
        </IconButton>
      </div>
    </div>
  );
}

interface IconButtonProps {
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function IconButton({ label, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={[
        'flex size-7 items-center justify-center rounded-md text-xs',
        'text-text-muted hover:bg-surface hover:text-text',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ScoreBadge({ percent }: { percent: number }) {
  const color =
    percent >= 80
      ? 'text-success'
      : percent >= 60
      ? 'text-text'
      : 'text-warning';
  return <span className={['font-sans text-sm font-bold', color].join(' ')}>{percent}%</span>;
}

function formatDate(sqliteTimestamp: string): string {
  const datePart = sqliteTimestamp.split(' ')[0];
  if (!datePart) return sqliteTimestamp;
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return datePart;
  return `${day}/${month}/${year}`;
}
