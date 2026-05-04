import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TopicCard } from '@/components/TopicCard';
import { TopicModal } from '@/components/TopicModal';
import { useIPC } from '@/hooks/useIPC';
import { useTopics } from '@/hooks/useTopics';
import { ROUTES, topicViewPath } from '@/lib/constants';
import type { Subject, Topic } from '@/types/ipc';

export function SubjectView() {
  const api = useIPC();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [subject, setSubject] = useState<Subject | null | undefined>(undefined);
  const { topics, loading, error, create, update, remove } = useTopics(id);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Topic | null>(null);
  const [deleting, setDeleting] = useState(false);

  /*
    Carrega a matéria pelo id da rota. Se voltar `null`, a matéria foi
    apagada (ou o id é inválido) — mostramos um aviso e link de volta.
  */
  useEffect(() => {
    if (!id) {
      setSubject(null);
      return;
    }
    void api.subjects.get(id).then(setSubject);
  }, [api, id]);

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(topic: Topic) {
    setEditing(topic);
    setModalOpen(true);
  }

  async function handleSubmit(input: Parameters<typeof create>[0]) {
    if (editing) {
      await update(editing.id, input);
    } else {
      await create(input);
    }
  }

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

  // ── Estados de carregamento da matéria ────────────────────────────────────
  if (subject === undefined) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Carregando…" />
      </div>
    );
  }

  if (subject === null) {
    return (
      <div className="flex flex-1 flex-col">
        <Header title="Matéria não encontrada" />
        <main className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <p className="font-sans text-base text-text-muted">
              Essa matéria não existe ou foi removida.
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
    <div className="flex flex-1 flex-col overflow-auto">
      <Header
        title={`${subject.emoji} ${subject.name}`}
        subtitle={`${topics.length} ${topics.length === 1 ? 'tópico' : 'tópicos'}`}
      />

      <main className="flex flex-1 flex-col gap-6 p-8 pb-24">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.HOME)}>
            ← Voltar
          </Button>
          <Button onClick={openCreate}>+ Novo tópico</Button>
        </div>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 font-sans text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-sans text-sm text-text-muted">Carregando tópicos…</p>
        ) : topics.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-4xl">🗂️</p>
            <p className="mt-3 font-sans text-base font-medium text-text">
              Nenhum tópico ainda
            </p>
            <p className="mt-1 max-w-sm font-sans text-sm text-text-muted">
              Crie tópicos para organizar o material desta matéria.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                onClick={() => navigate(topicViewPath(topic.id))}
                onEdit={() => openEdit(topic)}
                onDelete={() => setDeleteTarget(topic)}
              />
            ))}
          </div>
        )}
      </main>

      <TopicModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        initial={editing}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={`Remover "${deleteTarget?.name ?? ''}"?`}
        confirmLabel="Remover"
        confirmVariant="danger"
        onConfirm={handleConfirmDelete}
        confirmLoading={deleting}
      >
        <p>
          Os materiais e dados ligados a esse tópico também serão apagados.
          A ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
  );
}
