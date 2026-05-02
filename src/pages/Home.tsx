import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SubjectCard } from '@/components/SubjectCard';
import { SubjectModal } from '@/components/SubjectModal';
import { useSubjects } from '@/hooks/useSubjects';
import { subjectViewPath } from '@/lib/constants';
import type { Subject } from '@/types/ipc';

export function Home() {
  const navigate = useNavigate();
  const { subjects, loading, error, create, update, remove } = useSubjects();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Subject | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditing(undefined);
    setModalOpen(true);
  }

  function openEdit(subject: Subject) {
    setEditing(subject);
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

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <Header title="Início" subtitle="Suas matérias de estudo" />

      <main className="flex-1 p-8">
        {error && (
          <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 font-sans text-sm text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-sans text-sm text-text-muted">Carregando…</p>
        ) : subjects.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : (
          <SubjectsGrid
            subjects={subjects}
            onCreate={openCreate}
            onOpen={(subject) => navigate(subjectViewPath(subject.id))}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
        )}
      </main>

      <SubjectModal
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
          Os tópicos, materiais e dados ligados a esta matéria também serão apagados.
          A ação não pode ser desfeita.
        </p>
      </Modal>
    </div>
  );
}

interface EmptyStateProps {
  onCreate: () => void;
}

function EmptyState({ onCreate }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="text-5xl">📚</p>
      <p className="mt-4 font-sans text-base font-medium text-text">
        Nenhuma matéria ainda
      </p>
      <p className="mt-2 max-w-sm font-sans text-sm text-text-muted">
        Crie sua primeira matéria para começar a organizar seus estudos.
      </p>
      <div className="mt-6">
        <Button onClick={onCreate}>+ Nova matéria</Button>
      </div>
    </div>
  );
}

interface GridProps {
  subjects: Subject[];
  onCreate: () => void;
  onOpen: (subject: Subject) => void;
  onEdit: (subject: Subject) => void;
  onDelete: (subject: Subject) => void;
}

function SubjectsGrid({ subjects, onCreate, onOpen, onEdit, onDelete }: GridProps) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="font-sans text-sm text-text-muted">
          {subjects.length} {subjects.length === 1 ? 'matéria' : 'matérias'}
        </p>
        <Button onClick={onCreate}>+ Nova matéria</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {subjects.map((subject) => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            onClick={() => onOpen(subject)}
            onEdit={() => onEdit(subject)}
            onDelete={() => onDelete(subject)}
          />
        ))}
      </div>
    </div>
  );
}
