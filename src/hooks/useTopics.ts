import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type { CreateTopicInput, Topic, UpdateTopicInput } from '@/types/ipc';

/*
  Hook de domínio para tópicos. Sempre escopado por matéria — não faz sentido
  listar todos os tópicos do app no v0.2.0 (cada tela fala de uma matéria
  específica). Se essa visão global virar requisito, expande aqui.

  💡 `subjectId` pode ser undefined enquanto a rota carrega. Nesse caso o
  hook só passa pra `loading: false` com lista vazia, sem chamar IPC.
*/
export function useTopics(subjectId: string | undefined) {
  const api = useIPC();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!subjectId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.topics.listBySubject(subjectId);
      setTopics(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, subjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
    Esses três criam um patch de mutação + refresh. O parâmetro `subjectId`
    do create é injetado aqui — quem chama só precisa passar name/description.
  */
  const create = useCallback(
    async (input: Omit<CreateTopicInput, 'subjectId'>) => {
      if (!subjectId) throw new Error('subjectId é obrigatório para criar tópico');
      await api.topics.create({ ...input, subjectId });
      await refresh();
    },
    [api, refresh, subjectId],
  );

  const update = useCallback(
    async (id: string, patch: UpdateTopicInput) => {
      await api.topics.update(id, patch);
      await refresh();
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.topics.delete(id);
      await refresh();
    },
    [api, refresh],
  );

  return { topics, loading, error, refresh, create, update, remove };
}
