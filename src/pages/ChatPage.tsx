import { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { ChatConversationList } from '@/components/chat/ChatConversationList';
import { ScopeSelector } from '@/components/chat/ScopeSelector';
import { useChat } from '@/hooks/useChat';
import { useConversations } from '@/hooks/useConversations';
import { useIPC } from '@/hooks/useIPC';
import type {
  ChatScope,
  ConversationSummary,
  Subject,
  Topic,
} from '@/types/ipc';

/*
  Chat fullscreen (v0.8.0+, dropdown de escopo em v0.8.3).

  Layout 2 colunas: lista de conversas | mensagens.

  Escopo default: GLOBAL. Aluno pode trocar pra Matéria/Tópico via
  ScopeSelector no topo. Cada conversa fica fixa no escopo em que foi
  criada (já é assim — backend deriva escopo da conversation).

  scope_id pra global é o literal 'global' — exigido pelo NOT NULL do
  schema de conversations.scope_id mas não é usado pelo RAG.
*/

const GLOBAL_SCOPE: ChatScope = { scopeType: 'global', scopeId: 'global' };

export function ChatPage() {
  const api = useIPC();
  const [scope, setScope] = useState<ChatScope>(GLOBAL_SCOPE);
  const [selected, setSelected] = useState<string | null>(null);
  const conversations = useConversations(scope);

  // Carrega subjects + topics pra alimentar o ScopeSelector (1× no mount)
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topicsBySubject, setTopicsBySubject] = useState<Record<string, Topic[]>>({});
  const [scopeLoading, setScopeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const subs = await api.subjects.list();
        if (cancelled) return;
        setSubjects(subs);

        const topicsMap: Record<string, Topic[]> = {};
        await Promise.all(
          subs.map(async (s) => {
            const ts = await api.topics.listBySubject(s.id);
            topicsMap[s.id] = ts;
          }),
        );
        if (cancelled) return;
        setTopicsBySubject(topicsMap);
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Ao trocar escopo, deseleciona a conversa atual (não pertence ao novo escopo)
  function handleScopeChange(newScope: ChatScope) {
    setScope(newScope);
    setSelected(null);
  }

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
      <Header title="Chat" />

      <main className="flex flex-1 overflow-hidden">
        {/* Coluna 1: lista de conversas */}
        <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-bg">
          {/* ScopeSelector no topo: filtra a lista de conversas + define
              escopo de novas conversas */}
          <div className="flex flex-col gap-1.5 border-b border-border p-3">
            <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
              Buscar em
            </p>
            <ScopeSelector
              scope={scope}
              onChange={handleScopeChange}
              subjects={subjects}
              topicsBySubject={topicsBySubject}
              loading={scopeLoading}
            />
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
                  {scope.scopeType === 'global'
                    ? 'Pergunte sobre todo o seu material'
                    : 'Pergunte sobre o material do escopo selecionado'}
                </p>
                <p className="mt-2 font-sans text-sm text-text-muted">
                  Crie uma nova conversa ou abra uma existente na lista ao
                  lado. Pra mudar de escopo, use o seletor "Buscar em".
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
