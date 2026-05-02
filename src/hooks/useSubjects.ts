import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type { CreateSubjectInput, Subject, UpdateSubjectInput } from '@/types/ipc';

/*
  Hook de domínio que encapsula o estado e as operações de matérias.
  Padrão: faz a chamada IPC, espera o sucesso, e dá refresh na lista.

  Por que sempre dar refresh em vez de manipular o estado local? Porque o
  banco é a fonte da verdade. Se outra tela editar/criar matéria, queremos
  que a próxima leitura reflita isso. Em apps maiores trocaríamos por
  uma cache invalidation lib (TanStack Query), mas pra v0.2.0 o re-fetch
  é simples e correto.
*/
export function useSubjects() {
  const api = useIPC();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.subjects.list();
      setSubjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateSubjectInput) => {
      await api.subjects.create(input);
      await refresh();
    },
    [api, refresh],
  );

  const update = useCallback(
    async (id: string, patch: UpdateSubjectInput) => {
      await api.subjects.update(id, patch);
      await refresh();
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.subjects.delete(id);
      await refresh();
    },
    [api, refresh],
  );

  return { subjects, loading, error, refresh, create, update, remove };
}
