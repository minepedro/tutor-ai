import type { Topic } from '@/types/ipc';

interface Props {
  topic: Topic;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopicCard({ topic, onClick, onEdit, onDelete }: Props) {
  return (
    <div
      className={[
        'group flex flex-col rounded-[10px] border border-border bg-bg-elevated p-4',
        'transition-all duration-150',
        onClick ? 'cursor-pointer hover:border-accent/40 hover:shadow-md hover:shadow-black/30' : '',
      ].join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-sans text-sm font-semibold text-text">{topic.name}</p>

        <div className="flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {onEdit && (
            <IconButton
              label="Editar tópico"
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
              label="Remover tópico"
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

      {topic.description && (
        <p className="mt-2 line-clamp-2 font-sans text-xs text-text-muted">
          {topic.description}
        </p>
      )}
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
        'flex size-6 items-center justify-center rounded-md text-xs',
        'text-text-muted hover:bg-surface hover:text-text',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
