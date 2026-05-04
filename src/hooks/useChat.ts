import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type {
  ChatMessage,
  ChatRagChunk,
  Conversation,
} from '@/types/ipc';

/*
  Hook pra uma conversa específica. Carrega as mensagens, expõe `send` que
  dispara o pipeline de chat no backend (RAG + Claude) e atualiza o histórico.

  Optimistic UI: ao enviar, mostra a mensagem do usuário imediatamente (com
  flag `pending`) e um placeholder "digitando…" do assistant. Quando o backend
  retorna, substitui pelas mensagens reais. Se der erro, remove o pending e
  mostra o erro — mensagem do usuário não é perdida (já está no DB).
*/

export interface PendingState {
  /** Texto que o usuário enviou e ainda não tem resposta. */
  userContent: string;
}

/*
  💡 Não recebe `scope` como prop — o backend deriva o escopo da própria
  conversa (lido do DB). Garante que o RAG continua coerente mesmo se o
  usuário muda de página no meio da conversa.
*/
export function useChat(conversationId: string | null) {
  const api = useIPC();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingState | null>(null);

  /** Map messageId → chunks usados pra resposta (UI mostra "fontes"). */
  const [chunksByMessageId, setChunksByMessageId] = useState<Record<string, ChatRagChunk[]>>(
    {},
  );

  // Carrega conversa quando id muda
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.chat.get(conversationId).then((c) => {
      if (cancelled) return;
      setConversation(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, conversationId]);

  const send = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!conversationId || !trimmed || sending) return;

      setSending(true);
      setError(null);
      setPending({ userContent: trimmed });

      try {
        const result = await api.chat.sendMessage(conversationId, trimmed);

        // Adiciona ambas as mensagens (user real + assistant) ao histórico.
        setConversation((prev) =>
          prev
            ? {
                ...prev,
                messages: [...prev.messages, result.userMessage, result.assistantMessage],
              }
            : null,
        );
        // Salva chunks da resposta (UI mostra fontes embaixo da assistant msg).
        setChunksByMessageId((prev) => ({
          ...prev,
          [result.assistantMessage.id]: result.chunks,
        }));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);

        /*
          Mesmo em erro, a user message foi persistida pelo backend antes do
          erro (ver chat.service.ts). Pra UI ficar consistente, recarrego a
          conversa do DB — fica com user msg sem resposta. Usuário pode
          reenviar (vai criar mensagem nova).
        */
        try {
          const fresh = await api.chat.get(conversationId);
          if (fresh) setConversation(fresh);
        } catch {
          // Se a re-busca também falhar, pelo menos o erro principal aparece.
        }
      } finally {
        setSending(false);
        setPending(null);
      }
    },
    [api, conversationId, sending],
  );

  return {
    conversation,
    loading,
    sending,
    error,
    pending,
    chunksByMessageId,
    send,
  };
}

export type { ChatMessage };
