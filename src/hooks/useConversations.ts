import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type { ChatScope, Conversation, ConversationSummary } from '@/types/ipc';

/*
  Hook pra listar e gerenciar conversas de um escopo (document/topic/subject).
  O `scope` é estável durante a vida do painel — o hook re-busca quando ele muda.
*/
export function useConversations(scope: ChatScope | null) {
  const api = useIPC();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!scope) {
      setConversations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.chat.listConversations(scope);
      setConversations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (title?: string): Promise<Conversation | null> => {
      if (!scope) return null;
      try {
        const conv = await api.chat.create({
          scopeType: scope.scopeType,
          scopeId: scope.scopeId,
          ...(title ? { title } : {}),
        });
        await refresh();
        return conv;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [api, scope, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.chat.delete(id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      try {
        await api.chat.rename(id, title);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, refresh],
  );

  return { conversations, loading, error, refresh, create, remove, rename };
}
