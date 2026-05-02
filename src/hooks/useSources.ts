import { useCallback, useEffect, useState } from 'react';
import { useIPC } from './useIPC';
import type { EmbeddingProgress, Source } from '@/types/ipc';

/*
  Hook de domínio para sources de um tópico. Diferente de useSubjects/useTopics,
  a "criação" aqui passa pelo namespace `files` (porque envolve dialog do SO +
  cópia em disco), não por `sources` direto.

  Esse hook também coordena a INGESTÃO automática após upload: lê o resultado
  do dialog, dispara `embeddings:ingest`, e mantém um estado de progresso por
  sourceId que a UI consulta pra mostrar "processando…" no card.
*/
export function useSources(topicId: string | undefined) {
  const api = useIPC();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<Record<string, EmbeddingProgress>>({});

  const refresh = useCallback(async () => {
    if (!topicId) {
      setSources([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSources(await api.sources.listByTopic(topicId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, topicId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
    Subscreve eventos de progresso da ingestão. Cada evento traz sourceId
    + pct + status. Quando pct == 100, removemos do dicionário (a UI volta a
    ler `rawText !== null` e `chunkCount` da source).
  */
  useEffect(() => {
    const unsubscribe = api.embeddings.onProgress((event) => {
      setProgress((prev) => {
        if (event.pct >= 100) {
          const { [event.sourceId]: _done, ...rest } = prev;
          return rest;
        }
        return { ...prev, [event.sourceId]: event };
      });
    });
    return unsubscribe;
  }, [api]);

  /*
    Helper interno: dada uma lista de sources recém-criadas (ou já existentes),
    refresha a UI e dispara ingestão em série pras que ainda não têm rawText.
    Sequencial pra não saturar o ONNX (uma sessão, processo único).
  */
  const processNewSources = useCallback(
    async (newSources: Source[]) => {
      if (newSources.length === 0) return;
      await refresh();

      for (const source of newSources) {
        if (source.rawText !== null) continue; // já indexada antes
        try {
          await api.embeddings.ingest(source.id);
        } catch (ingestErr) {
          setError(ingestErr instanceof Error ? ingestErr.message : String(ingestErr));
          // Continua com os próximos arquivos mesmo se um falhar.
        }
      }
      await refresh();
    },
    [api, refresh],
  );

  /**
   * Abre o dialog (multi-select) e processa todos os arquivos escolhidos.
   * Retorna a lista de sources criadas/encontradas (vazia se cancelou).
   */
  const upload = useCallback(async (): Promise<Source[]> => {
    if (!topicId) throw new Error('topicId é obrigatório para upload');
    setUploading(true);
    setError(null);
    try {
      const sources = await api.files.pickAndUpload(topicId);
      await processNewSources(sources);
      return sources;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      setUploading(false);
    }
  }, [api, processNewSources, topicId]);

  /**
   * Versão drag-and-drop: recebe paths absolutos já resolvidos
   * (via `api.files.getDroppedPath`).
   */
  const uploadFromPaths = useCallback(
    async (paths: string[]): Promise<Source[]> => {
      if (!topicId) throw new Error('topicId é obrigatório para upload');
      if (paths.length === 0) return [];
      setUploading(true);
      setError(null);
      try {
        const sources = await api.files.uploadFromPaths(topicId, paths);
        await processNewSources(sources);
        return sources;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return [];
      } finally {
        setUploading(false);
      }
    },
    [api, processNewSources, topicId],
  );

  const remove = useCallback(
    async (sourceId: string) => {
      await api.files.deleteSource(sourceId);
      await refresh();
    },
    [api, refresh],
  );

  return {
    sources,
    loading,
    uploading,
    error,
    progress,
    refresh,
    upload,
    uploadFromPaths,
    remove,
  };
}
