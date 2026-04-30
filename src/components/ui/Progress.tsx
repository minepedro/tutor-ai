interface Props {
  /** Valor entre 0 e 100. */
  value: number;
  /** Texto exibido abaixo da barra (opcional). */
  label?: string;
  size?: 'sm' | 'md';
}

export function Progress({ value, label, size = 'md' }: Props) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && (
        <span className="font-sans text-xs text-text-muted">{label}</span>
      )}
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={[
          'w-full overflow-hidden rounded-full bg-surface',
          size === 'sm' ? 'h-1' : 'h-2',
        ].join(' ')}
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-300 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
