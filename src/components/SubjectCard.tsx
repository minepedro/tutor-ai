import { type CSSProperties } from 'react';
import type { Subject } from '@/types/ipc';

interface Props {
  subject: Subject;
  /** Disparado quando o usuário clica no card (entrar na matéria). */
  onClick?: () => void;
  /** Disparado pelo botão de editar (canto superior direito). */
  onEdit?: () => void;
  /** Disparado pelo botão de remover. */
  onDelete?: () => void;
}

export function SubjectCard({ subject, onClick, onEdit, onDelete }: Props) {
  /*
    💡 Cor do usuário entra como inline style porque é dinâmica — o Tailwind
    não consegue gerar classes a partir de strings em runtime. Usar CSS vars
    permite estilizar pseudoselectors via Tailwind sem perder a cor custom.
  */
  const accentStyle: CSSProperties = {
    backgroundColor: subject.color,
  };

  return (
    <div
      className={[
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-[12px]',
        'border border-border bg-bg-elevated p-5',
        'transition-all duration-150',
        'hover:border-accent/40 hover:shadow-lg hover:shadow-black/30',
      ].join(' ')}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* faixa de cor à esquerda */}
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={accentStyle}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3">
        <span className="text-3xl leading-none">{subject.emoji}</span>

        {/* ações — aparecem só no hover do card */}
        <div className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {onEdit && (
            <IconButton
              label="Editar"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              ✏️
            </IconButton>
          )}
          {onDelete && (
            <IconButton
              label="Remover"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              🗑️
            </IconButton>
          )}
        </div>
      </div>

      <p className="mt-4 font-sans text-base font-semibold text-text">
        {subject.name}
      </p>
      <p className="mt-1 font-sans text-xs text-text-subtle">
        Criada em {formatDate(subject.createdAt)}
      </p>
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

/*
  Formato vindo do SQLite: 'YYYY-MM-DD HH:MM:SS' (UTC). Mostramos só a data
  no fuso local. Não usamos `new Date(string)` direto porque o formato sem
  o 'T' tem suporte irregular em browsers — preferimos parsear manualmente.
*/
function formatDate(sqliteTimestamp: string): string {
  const datePart = sqliteTimestamp.split(' ')[0];
  if (!datePart) return sqliteTimestamp;
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return datePart;
  return `${day}/${month}/${year}`;
}
