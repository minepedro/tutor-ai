import { useEffect, useRef, useState } from 'react';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatInput } from '@/components/chat/ChatInput';
import { useIPC } from '@/hooks/useIPC';
import type { ChatMessage as ChatMessageType, Conversation } from '@/types/ipc';

interface Props {
  /** ID da pergunta de quiz. Usado pra criar/recuperar a conversation. */
  quizQuestionId: string;
  /**
   * Estado do aluno na pergunta — controla o placeholder do input
   * (sócrático antes de marcar; explicativo depois).
   */
  state: 'unanswered' | 'correct' | 'wrong';
}

/*
  Chat inline em uma pergunta de quiz (v0.7.0).

  Reusa `ChatMessage` (renderização markdown/LaTeX) e `ChatInput` do chat
  global. A conversation é criada lazy no backend na 1ª chamada de
  `askQuizDoubt` — esse componente só faz `getQuizDoubt` no mount pra
  recuperar histórico se já houver.

  Mensagens UI:
  - 'pending': aluno enviou, aguardando resposta. Mostra "digitando…".
    Optimistic UI: pergunta aparece imediatamente, mesmo antes do servidor
    ter persistido.
*/
type PendingMessage = ChatMessageType & { pending?: boolean };

const PLACEHOLDERS: Record<Props['state'], string> = {
  unanswered: 'Pedir uma dica (sem entregar a resposta)…',
  correct: 'Aprofundar, conectar com outros conceitos…',
  wrong: 'Entender por que errei, ver de outro ângulo…',
};

export function QuizDoubtChat({ quizQuestionId, state }: Props) {
  const api = useIPC();
  const [messages, setMessages] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carrega conversa existente no mount (pode não existir ainda).
  useEffect(() => {
    let cancelled = false;
    void api.chat.getQuizDoubt(quizQuestionId).then((conv: Conversation | null) => {
      if (cancelled) return;
      setMessages(conv?.messages ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, quizQuestionId]);

  // Scroll pra última msg quando lista muda
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  async function handleSend(content: string) {
    setError(null);

    // Optimistic UI: mostra a pergunta imediatamente + placeholder de "digitando"
    const optimisticUser: PendingMessage = {
      id: `pending-user-${Date.now()}`,
      conversationId: '',
      role: 'user',
      content,
      contextChunkIds: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    const typingPlaceholder: PendingMessage = {
      id: `pending-assistant-${Date.now()}`,
      conversationId: '',
      role: 'assistant',
      content: '_digitando…_',
      contextChunkIds: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimisticUser, typingPlaceholder]);
    setSubmitting(true);

    try {
      const result = await api.chat.askQuizDoubt(quizQuestionId, content);
      // Substitui as 2 mensagens pending pelas reais retornadas pelo backend.
      setMessages((prev) => {
        const withoutPending = prev.filter((m) => !m.pending);
        return [...withoutPending, result.userMessage, result.assistantMessage];
      });
    } catch (err) {
      // Rollback: remove as 2 pending. Mostra erro.
      setMessages((prev) => prev.filter((m) => !m.pending));
      setError(err instanceof Error ? err.message : 'Falha ao enviar dúvida');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="border-t border-border px-4 py-6 text-center font-sans text-sm text-text-muted">
        Carregando dúvidas anteriores…
      </div>
    );
  }

  return (
    <div className="flex flex-col border-t border-border bg-bg">
      {/* Lista de mensagens — limitada a max-h pra não estourar o card */}
      <div
        ref={scrollRef}
        className="flex max-h-[420px] flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <p className="text-center font-sans text-sm text-text-subtle">
            Pergunte qualquer coisa sobre essa questão. A IA vê a pergunta,
            as alternativas e a explicação oficial.
          </p>
        )}
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 font-sans text-sm text-danger">
          {error}
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        disabled={submitting}
        placeholder={PLACEHOLDERS[state]}
      />
    </div>
  );
}
