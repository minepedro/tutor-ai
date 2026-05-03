import type { QuizQuestion } from '@/types/ipc';

interface Props {
  question: QuizQuestion;
  /** Posição atual (1-based pra display). */
  index: number;
  /** Total de perguntas no quiz. */
  total: number;
}

const DIFFICULTY_LABEL: Record<QuizQuestion['difficulty'], string> = {
  easy: 'Fácil',
  medium: 'Médio',
  hard: 'Difícil',
};

const DIFFICULTY_CLASSES: Record<QuizQuestion['difficulty'], string> = {
  easy: 'bg-success/15 text-success border-success/30',
  medium: 'bg-warning/15 text-warning border-warning/30',
  hard: 'bg-danger/15 text-danger border-danger/30',
};

const TYPE_LABEL: Record<QuizQuestion['type'], string> = {
  multiple_choice: 'Múltipla escolha',
  true_false: 'Verdadeiro/Falso',
};

export function QuizCard({ question, index, total }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {/* Header com badges + posição */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge>{TYPE_LABEL[question.type]}</Badge>
          <Badge className={DIFFICULTY_CLASSES[question.difficulty]}>
            {DIFFICULTY_LABEL[question.difficulty]}
          </Badge>
        </div>
        <span className="font-sans text-sm text-text-muted">
          {index} de {total}
        </span>
      </div>

      {/* Pergunta */}
      <h2 className="font-sans text-lg font-semibold leading-relaxed text-text">
        {question.question}
      </h2>
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

function Badge({ children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5',
        'font-sans text-xs font-medium',
        className || 'border-border bg-surface text-text-muted',
      ].join(' ')}
    >
      {children}
    </span>
  );
}
