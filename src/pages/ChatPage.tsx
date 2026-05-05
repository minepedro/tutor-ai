import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatConversationList } from '@/components/chat/ChatConversationList';
import { useChat } from '@/hooks/useChat';
import { useConversations } from '@/hooks/useConversations';
import type { ChatScope, ConversationSummary } from '@/types/ipc';

/*
  Chat fullscreen (v0.8.0+).

  Layout 2 colunas: lista de conversas | mensagens.
  (A 3ª coluna do plano original — "fontes" — fica inline na ChatMessage
  via ChatSources, igual o drawer atual. Coluna lateral dedicada pode
  vir em v0.8.1 se for útil.)

  Escopo default: GLOBAL (busca em todos os PDFs). Pra v0.8.0, escopo é
  fixo em global; troca pra topic/subject vai pra v0.8.1+.

  scope_id pra global é o literal 'global' — exigido pelo NOT NULL do
  schema de conversations.scope_id mas não é usado pelo RAG.
*/

const GLOBAL_SCOPE: ChatScope = { scopeType: 'global', scopeId: 'global' };

export function ChatPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const conversations = useConversations(GLOBAL_SCOPE);

  const [renameTarget, setRenameTarget] = useState<ConversationSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleCreate() {
    const conv = await conversations.create();
    if (conv) setSelected(conv.id);
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
      if (selected === deleteTarget.id) setSelected(null);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Header title="Chat" subtitle="🌐 Buscando em todo o seu material" />

      <main className="flex flex-1 overflow-hidden">
        {/* Coluna 1: lista de conversas */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-bg">
          <div className="border-b border-border p-3">
            <Button onClick={handleCreate} disabled={conversations.loading}>
              + Nova conversa
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.error ? (
              <div className="m-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-sans text-sm text-danger">
                {conversations.error}
              </div>
            ) : (
              <ChatConversationList
                conversations={conversations.conversations}
                loading={conversations.loading}
                onSelect={setSelected}
                onCreate={handleCreate}
                onRename={openRename}
                onDelete={setDeleteTarget}
              />
            )}
          </div>
        </aside>

        {/* Coluna 2: mensagens */}
        <section className="flex flex-1 flex-col overflow-hidden">
          {selected ? (
            <ChatConversation conversationId={selected} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-12 text-center">
              <div className="max-w-md">
                <p className="mb-3 text-5xl">💬</p>
                <p className="font-sans text-base font-semibold text-text">
                  Pergunte sobre todo o seu material
                </p>
                <p className="mt-2 font-sans text-sm text-text-muted">
                  Esse chat busca em <strong>todos os PDFs</strong> que você subiu —
                  qualquer matéria, qualquer tópico. Crie uma nova conversa ou abra uma
                  existente na lista ao lado.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>

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
    </div>
  );
}

interface ConversationProps {
  conversationId: string;
}

function ChatConversation({ conversationId }: ConversationProps) {
  const chat = useChat(conversationId);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.conversation?.messages.length, chat.pending]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-6">
          {chat.loading ? (
            <p className="text-center font-sans text-xs text-text-subtle">
              Carregando…
            </p>
          ) : (
            <>
              {chat.conversation?.messages.length === 0 && !chat.pending && (
                <div className="rounded-md border border-border bg-bg-elevated p-4 text-center">
                  <p className="font-sans text-sm text-text-muted">
                    Pergunte qualquer coisa sobre seu material. As respostas vêm
                    dos seus PDFs (não do conhecimento geral da IA).
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
            </>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <ChatInput
          onSend={chat.send}
          disabled={chat.sending || !chat.conversation}
        />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      className="inline-block size-1.5 animate-pulse rounded-full bg-text-muted"
      style={{ animationDelay: `${delay}ms` }}
    />
  );
}
