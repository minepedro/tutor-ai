import { type InputHTMLAttributes, useId } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = '', ...rest }: Props) {
  /*
    💡 `useId()` gera um ID único estável por instância do componente.
    Isso permite ligar o <label> ao <input> via htmlFor/id sem inventar strings
    manualmente — essencial para acessibilidade (screen readers).
  */
  const id = useId();

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="font-sans text-sm font-medium text-text-muted">
          {label}
        </label>
      )}
      <input
        id={id}
        className={[
          'w-full rounded-[8px] border bg-surface px-3 py-2',
          'font-sans text-sm text-text placeholder:text-text-subtle',
          'outline-none transition-colors duration-150',
          error
            ? 'border-danger focus:border-danger focus:ring-1 focus:ring-danger'
            : 'border-border focus:border-accent focus:ring-1 focus:ring-accent',
          'disabled:pointer-events-none disabled:opacity-40',
          className,
        ].join(' ')}
        {...rest}
      />
      {error && <p className="font-sans text-xs text-danger">{error}</p>}
      {!error && hint && <p className="font-sans text-xs text-text-subtle">{hint}</p>}
    </div>
  );
}
