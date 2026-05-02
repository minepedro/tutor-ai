import { useEffect, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SourceCard } from '@/components/SourceCard';
import { useIPC } from '@/hooks/useIPC';
import { useSources } from '@/hooks/useSources';
import { ROUTES, subjectViewPath } from '@/lib/constants';
import type { Source, Subject, Topic } from '@/types/ipc';

export function TopicView() {
  const api = useIPC();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [topic, setTopic] = useState<Topic | null | undefined>(undefined);
  const [subject, setSubject] = useState<Subject | null>(null);
  const {
    sources,
    loading,
    uploading,
    error,
    progress,
    upload,
    uploadFromPaths,
    remove,
  } = useSources(id);

  const [deleteTarget, setDeleteTarget] = useState<Source | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    if (!id) {
      setTopic(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const t = await api.topics.get(id);
      if (cancelled) return;
      setTopic(t);
      if (t) {
        const s = await api.subjects.get(t.subjectId);
        if (!cancelled) setSubject(s);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  /*
    💡 Drag-and-drop em Electron 32+:
    1. preventDefault() em dragenter/dragover é obrigatório, senão o navegador
       trata como navegação (abre o PDF no lugar da app).
    2. file.path foi removido — usamos webUtils.getPathForFile via preload.
    3. Filtramos PDFs no renderer pra dar feedback rápido (vs deixar o backend
       rejeitar com erro genérico).
  */
  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Só desativa quando sair de fato do container (não ao passar por filhos).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragActive(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const dropped = Array.from(e.dataTransfer.files);
    const pdfs = dropped.filter((f) => f.name.toLowerCase().endsWith('.pdf'));

    if (pdfs.length === 0) return;

    const paths = pdfs.map((f) => api.files.getDroppedPath(f));
    await uploadFromPaths(paths);
  }

  // ── Estados de carregamento ──────────────────────────────────────────────
  if (topic === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando…" />
      </div>
    );
  }

  if (topic === null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Tópico não encontrado" />
        <main className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <p className="font-sans text-base text-text-muted">
              Esse tópico não existe ou foi removido.
            </p>
            <div className="mt-4">
              <Button variant="secondary" onClick={() => navigate(ROUTES.HOME)}>
                ← Voltar para o início
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-1 flex-col overflow-auto"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Header
        title={topic.name}
        subtitle={
          subject
            ? `${subject.emoji} ${subject.name} · ${sources.length} ${sources.length === 1 ? 'material' : 'materiais'}`
            : `${sources.length} ${sources.length === 1 ? 'material' : 'materiais'}`
        }
      />

      <main className="flex flex-1 flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              subject ? navigate(subjectViewPath(subject.id)) : navigate(ROUTES.HOME)
            }
          >
            ← Voltar
          </Button>
          <Button onClick={() => void upload()} loading={uploading}>
            + Subir PDF
          </Button>
        </div>

        {topic.description && (
          <p className="font-sans text-sm text-text-muted">{topic.description}</p>
        )}

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 font-sans text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-sans text-sm text-text-muted">Carregando materiais…</p>
        ) : sources.length === 0 ? (
          <DropZone empty />
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                progress={progress[source.id]}
                onDelete={() => setDeleteTarget(source)}
              />
            ))}
            <p className="mt-2 text-center font-sans text-xs text-text-subtle">
              Arraste PDFs pra esta janela ou use o botão "+ Subir PDF"
            </p>
          </div>
        )}
      </main>

      {/*
        Overlay de drag — só aparece quando o usuário está arrastando arquivos
        sobre a janela. Posicionamento absoluto cobre a área inteira da página
        (mas fica abaixo do Modal por causa do z-index).
      */}
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bg/85 backdrop-blur-sm">
          <div className="rounded-[16px] border-2 border-dashed border-accent bg-bg-elevated px-12 py-10 text-center shadow-2xl">
            <p className="text-5xl">📥</p>
            <p className="mt-4 font-sans text-lg font-semibold text-text">
              Solte para subir
            </p>
            <p className="mt-1 font-sans text-sm text-text-muted">
              PDFs serão adicionados a "{topic.name}"
            </p>
          </div>
        </div>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Remover "${deleteTarget?.filename ?? ''}"?`}
        confirmLabel="Remover"
        confirmVariant="danger"
        onConfirm={handleConfirmDelete}
        confirmLoading={deleting}
      >
        <p>
          O arquivo será apagado do disco (se nenhum outro tópico estiver
          usando) e todos os chunks/embeddings associados serão removidos.
          A ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
  );
}

interface DropZoneProps {
  empty: boolean;
}

function DropZone({ empty }: DropZoneProps) {
  if (!empty) return null;
  return (
    <div className="flex flex-1 flex-col items-center justify-center rounded-[16px] border-2 border-dashed border-border p-10 text-center">
      <p className="text-5xl">📄</p>
      <p className="mt-4 font-sans text-base font-medium text-text">
        Nenhum material ainda
      </p>
      <p className="mt-1 max-w-sm font-sans text-sm text-text-muted">
        Arraste um ou mais PDFs pra esta janela, ou clique em "+ Subir PDF".
        O conteúdo é extraído, dividido em chunks e indexado pra busca.
      </p>
    </div>
  );
}
