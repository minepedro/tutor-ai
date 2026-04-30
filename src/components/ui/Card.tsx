import { type HTMLAttributes, type ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adiciona padding interno padrão. Default: true. */
  padded?: boolean;
}

export function Card({ children, padded = true, className = '', ...rest }: Props) {
  return (
    <div
      className={[
        'rounded-[12px] border border-border bg-bg-elevated',
        padded ? 'p-5' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
