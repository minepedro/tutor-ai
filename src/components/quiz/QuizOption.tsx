interface Props {
  text: string;
  /** Index da opção (0-based). Mostrado como letra A/B/C/D. */
  index: number;
  /** Esta opção está selecionada pelo usuário (antes de confirmar). */
  selected: boolean;
  /** Após confirmar: estado real (correta / errada). undefined antes. */
  state?: 'correct' | 'wrong' | 'idle';
  onClick: () => void;
  /** Quando true, clique não tem efeito (após reveal). */
  disabled: boolean;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

export function QuizOption({ text, index, selected, state, onClick, disabled }: Props) {
  /*
    Estados visuais:
    - default: borda neutra, hover discreto
    - selected (antes de confirmar): borda accent + bg accent suave
    - correct (após confirmar): borda + bg verde
    - wrong (após confirmar, e foi a selecionada): borda + bg vermelha
    - idle (após confirmar, opção não escolhida e não correta): muted
  */
  const visualClass = (() => {
    if (state === 'correct') {
      return 'border-success bg-success/10 text-text';
    }
    if (state === 'wrong') {
      return 'border-danger bg-danger/10 text-text';
    }
    if (state === 'idle') {
      return 'border-border bg-bg-elevated text-text-muted opacity-70';
    }
    if (selected) {
      return 'border-accent bg-accent/10 text-text';
    }
    return 'border-border bg-bg-elevated text-text hover:border-accent/40';
  })();

  const letterClass = (() => {
    if (state === 'correct') return 'bg-success text-bg';
    if (state === 'wrong') return 'bg-danger text-bg';
    if (state === 'idle') return 'bg-surface text-text-subtle';
    if (selected) return 'bg-accent text-white';
    return 'bg-surface text-text-muted';
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'group flex w-full items-start gap-3 rounded-[10px] border px-4 py-3',
        'text-left transition-all duration-150',
        'disabled:cursor-default',
        !disabled && 'cursor-pointer active:scale-[0.99]',
        visualClass,
      ].join(' ')}
    >
      <span
        className={[
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          'font-sans text-xs font-bold',
          'transition-colors',
          letterClass,
        ].join(' ')}
      >
        {LETTERS[index] ?? index + 1}
      </span>
      <span className="flex-1 font-sans text-sm leading-relaxed">{text}</span>

      {state === 'correct' && (
        <span className="text-success" aria-label="Correta">
          ✓
        </span>
      )}
      {state === 'wrong' && (
        <span className="text-danger" aria-label="Errada">
          ✗
        </span>
      )}
    </button>
  );
}
