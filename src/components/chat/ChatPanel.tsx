import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { useChat } from '@/hooks/useChat';
import { useConversations } from '@/hooks/useConversations';
import { useIPC } from '@/hooks/useIPC';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatConversationList } from './ChatConversationList';
import type { ChatScope, Conversation, ConversationSummary } from '@/types/ipc';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Escopo atual deduzido da rota (TopicView → topic, etc). Null = sem escopo. */
  scope: ChatScope | null;
  /** Texto pra mostrar no header descrevendo o escopo (ex: "📚 Cálculo II / Derivadas"). */
  scopeLabel?: string;
}

/*
  Drawer lateral direito do chat. 2 modos:
  - 'list': mostra lista de conversas anteriores + botão "Nova"
  - 'conversation': mostra mensagens da conversa selecionada + input

  Estado interno controla o modo. Ao fechar e reabrir, volta pra 'list'.
*/

type Mode =
  | { type: 'list' }
  | { type: 'conversation'; conversationId: string };

export function ChatPanel({ open, onClose, scope, scopeLabel }: Props) {
  const [mode, setMode] = useState<Mode>({ type: 'list' });
  const conversations = useConversations(scope);

  // Modal de renomear/excluir conversa (compartilhado pra ambas as views)
  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Reset mode toda vez que reabre
  useEffect(() => {
    if (!open) setMode({ type: 'list' });
  }, [open]);

  async function handleCreate() {
    const conv = await conversations.create();
    if (conv) setMode({ type: 'conversation', conversationId: conv.id });
  }

  function handleSelect(id: string) {
    setMode({ type: 'conversation', conversationId: id });
  }

  function openRename(conv: ConversationSummary) {
    setRenameTarget(conv);
    setRenameValue(conv.title ?? '');
  }

  async function handleRenameConfirm() {
    if (!renameTarget) return;
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) return;
    setRenaming(true);
    try {
      await conversations.rename(renameTarget.id, trimmed);
      setRenameTarget(null);
    } finally {
      setRenaming(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await conversations.remove(deleteTarget.id);
      // Se a conversa apagada era a aberta, volta pra lista
      if (mode.type === 'conversation' && mode.conversationId === deleteTarget.id) {
        setMode({ type: 'list' });
      }
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        className={[
          'fixed inset-y-0 right-0 z-30 flex w-full max-w-[440px] flex-col',
          'border-l border-border bg-bg shadow-2xl',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {mode.type === 'conversation' && (
            <button
              type="button"
              onClick={() => setMode({ type: 'list' })}
              aria-label="Voltar pra lista"
              className="text-text-muted hover:text-text"
            >
              ←
            </button>
          )}

          <div className="min-w-0 flex-1">
            <p className="font-sans text-sm font-semibold text-text">
              💬 {mode.type === 'list' ? 'Conversas' : 'Chat'}
            </p>
            {scopeLabel && (
              <p className="truncate font-sans text-xs text-text-muted">
                {scopeLabel}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar painel"
            className={[
              'flex size-7 items-center justify-center rounded-md',
              'text-text-muted hover:bg-surface hover:text-text',
              'transition-colors',
            ].join(' ')}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {!scope ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="font-sans text-sm text-text-muted">
              Abra um tópico, matéria ou material pra começar a conversar.
            </p>
          </div>
        ) : conversations.error ? (
          <div className="m-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-sans text-sm text-danger">
            {conversations.error}
          </div>
        ) : mode.type === 'list' ? (
          <div className="flex-1 overflow-auto">
            <ChatConversationList
              conversations={conversations.conversations}
              loading={conversations.loading}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onRename={openRename}
              onDelete={setDeleteTarget}
            />
          </div>
        ) : (
          <ChatConversation conversationId={mode.conversationId} />
        )}
      </div>

      {/* Modal de renomear */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Renomear conversa"
        confirmLabel="Salvar"
        onConfirm={handleRenameConfirm}
        confirmLoading={renaming}
      >
        <Input
          label="Novo título"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRenameConfirm();
          }}
        />
      </Modal>

      {/* Modal de excluir */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Excluir "${deleteTarget?.title ?? 'esta conversa'}"?`}
        confirmLabel="Excluir"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
        confirmLoading={deleting}
      >
        <p>
          A conversa e todas as mensagens dela serão apagadas. Não pode ser
          desfeito.
        </p>
      </Modal>
    </>
  );
}

/*
  Subcomponente que renderiza uma conversa específica. Separado pra que o
  `useChat` (que usa conversationId como dep) só rode quando temos id válido.

  Não recebe scope: o backend deriva o escopo da conversa internamente,
  garantindo coerência mesmo se o usuário muda de página no meio.
*/
interface ConversationProps {
  conversationId: string;
}

function ChatConversation({ conversationId }: ConversationProps) {
  const chat = useChat(conversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /*
    Mostra um chip indicando o escopo da CONVERSA (vindo do DB), não da rota
    atual. Importante deixar claro pro usuário "onde essa conversa vive" se
    ele navegou pra outra página com o painel aberto.
  */
  const scopeBadge = useConversationScopeBadge(chat.conversation);

  /*
    Auto-scroll pro fim toda vez que mensagens novas chegam ou que pending
    aparece (novo input do usuário).
  */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.conversation?.messages.length, chat.pending]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {scopeBadge && (
        <div className="border-b border-border bg-bg-elevated px-3 py-1.5">
          <p className="font-sans text-[11px] text-text-muted">
            <span className="text-text-subtle">Buscando em:</span> {scopeBadge}
          </p>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3">
        {chat.loading ? (
          <p className="text-center font-sans text-xs text-text-subtle">
            Carregando…
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {chat.conversation?.messages.length === 0 && !chat.pending && (
              <div className="rounded-md border border-border bg-bg-elevated p-4 text-center">
                <p className="font-sans text-sm text-text-muted">
                  Pergunte qualquer coisa sobre o material desse escopo.
                  As respostas vêm dos seus PDFs (não do conhecimento geral da IA).
                </p>
              </div>
            )}

            {chat.conversation?.messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                chunks={chat.chunksByMessageId[m.id]}
              />
            ))}

            {/* Optimistic UI: pergunta do usuário enquanto espera resposta */}
            {chat.pending && (
              <>
                <div className="flex flex-col items-end">
                  <div className="max-w-[85%] rounded-[12px] bg-accent/70 px-4 py-2.5 font-sans text-sm leading-relaxed text-white">
                    {chat.pending.userContent}
                  </div>
                </div>
                <div className="flex flex-col items-start">
                  <div className="rounded-[12px] border border-border bg-bg-elevated px-4 py-2.5 font-sans text-sm text-text-muted">
                    <span className="inline-flex gap-1">
                      <Dot delay={0} />
                      <Dot delay={150} />
                      <Dot delay={300} />
                    </span>
                  </div>
                </div>
              </>
            )}

            {chat.error && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-sans text-sm text-danger">
                {chat.error}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <ChatInput
        onSend={chat.send}
        disabled={chat.sending || !chat.conversation}
      />
    </div>
  );
}

/* Pequeno indicador de "digitando…" — bolinha animada com delay */
function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block size-1.5 animate-pulse rounded-full bg-text-muted"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}

/*
  Hook que resolve um label amigável pro escopo da conversa atual.
  Faz IPC pra pegar nome do subject/topic/source. Retorna string formatada
  ou null enquanto carrega.
*/
function useConversationScopeBadge(conversation: Conversation | null): string | null {
  const api = useIPC();
  const [badge, setBadge] = useState<string | null>(null);

  useEffect(() => {
    if (!conversation) {
      setBadge(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let result = '';
        if (conversation.scopeType === 'topic') {
          const topic = await api.topics.get(conversation.scopeId);
          if (topic) {
            const subject = await api.subjects.get(topic.subjectId);
            result = subject
              ? `${subject.emoji} ${subject.name} / ${topic.name}`
              : `Tópico: ${topic.name}`;
          }
        } else if (conversation.scopeType === 'subject') {
          const subject = await api.subjects.get(conversation.scopeId);
          if (subject) result = `Matéria inteira: ${subject.emoji} ${subject.name}`;
        } else if (conversation.scopeType === 'document') {
          const source = await api.sources.get(conversation.scopeId);
          if (source) result = `📄 ${source.filename}`;
        }
        if (!cancelled) setBadge(result || null);
      } catch {
        if (!cancelled) setBadge(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, conversation]);

  return badge;
}
