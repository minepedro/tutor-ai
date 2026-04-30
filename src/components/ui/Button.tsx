import { type ButtonHTMLAttributes, type ReactNode } from 'react';

/*
  💡 `type ButtonHTMLAttributes<HTMLButtonElement>` é um utility type do React
  que inclui TODOS os atributos HTML de um <button> (onClick, disabled, type, etc.).
  Ao fazer `interface Props extends ButtonHTMLAttributes<HTMLButtonElement>`,
  nosso Button aceita tudo que um button nativo aceita — sem precisar re-declarar
  cada prop.
*/
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<Props['variant'] & string, string> = {
  primary:
    'bg-accent text-white hover:bg-accent-hover active:scale-[0.98] shadow-sm shadow-accent/20',
  secondary:
    'bg-surface text-text border border-border hover:bg-border active:scale-[0.98]',
  ghost: 'text-text-muted hover:text-text hover:bg-surface active:scale-[0.98]',
  danger:
    'bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20 active:scale-[0.98]',
};

const sizeClasses: Record<NonNullable<Props['size']>, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <button
      disabled={disabled ?? loading}
      className={[
        'inline-flex items-center justify-center rounded-[8px] font-sans font-medium',
        'transition-all duration-150 outline-none',
        'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        'disabled:pointer-events-none disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading && (
        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
