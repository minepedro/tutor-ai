import type { ConversationSummary } from '@/types/ipc';

interface Props {
  conversations: ConversationSummary[];
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (conv: ConversationSummary) => void;
  onDelete: (conv: ConversationSummary) => void;
}

export function ChatConversationList({
  conversations,
  loading,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  return (
    <div className="flex flex-col gap-2 p-3">
      <button
        type="button"
        onClick={onCreate}
        className={[
          'flex items-center justify-center gap-2 rounded-[10px] border border-dashed',
          'border-accent/40 bg-accent/5 px-4 py-3',
          'font-sans text-sm font-medium text-accent',
          'hover:border-accent hover:bg-accent/10',
          'transition-colors',
        ].join(' ')}
      >
        + Nova conversa
      </button>

      {loading ? (
        <p className="px-3 py-4 text-center font-sans text-xs text-text-subtle">
          Carregando…
        </p>
      ) : conversations.length === 0 ? (
        <p className="mt-4 px-3 text-center font-sans text-xs text-text-subtle">
          Nenhuma conversa ainda. Comece uma nova acima.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              conversation={conv}
              onClick={() => onSelect(conv.id)}
              onRename={() => onRename(conv)}
              onDelete={() => onDelete(conv)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ItemProps {
  conversation: ConversationSummary;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function ConversationItem({ conversation, onClick, onRename, onDelete }: ItemProps) {
  return (
    <div
      className={[
        'group flex items-center gap-2 rounded-md px-2 py-2',
        'transition-colors',
        'hover:bg-surface',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 cursor-pointer text-left"
      >
        <p className="truncate font-sans text-sm font-medium text-text">
          {conversation.title ?? 'Sem título'}
        </p>
        {conversation.preview && (
          <p className="truncate font-sans text-xs text-text-subtle">
            {conversation.preview}
          </p>
        )}
        <p className="font-sans text-[10px] text-text-subtle">
          {conversation.messageCount}{' '}
          {conversation.messageCount === 1 ? 'mensagem' : 'mensagens'} ·{' '}
          {formatDate(conversation.updatedAt)}
        </p>
      </button>

      <div className="flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <IconButton
          label="Renomear conversa"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          ✏️
        </IconButton>
        <IconButton
          label="Excluir conversa"
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
        'flex size-6 items-center justify-center rounded text-xs',
        'text-text-muted hover:bg-bg hover:text-text',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function formatDate(sqliteTimestamp: string): string {
  const datePart = sqliteTimestamp.split(' ')[0];
  if (!datePart) return sqliteTimestamp;
  const [, month, day] = datePart.split('-');
  if (!month || !day) return datePart;
  return `${day}/${month}`;
}
