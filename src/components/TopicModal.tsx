import { useEffect, useId, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import type { CreateTopicInput, Topic } from '@/types/ipc';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Recebe os dados sem o subjectId — quem chama injeta. Pode lançar para abortar o close. */
  onSubmit: (input: Omit<CreateTopicInput, 'subjectId'>) => Promise<void>;
  initial?: Topic;
}

export function TopicModal({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const descId = useId();

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setDescription(initial?.description ?? '');
    setError('');
    setSubmitting(false);
  }, [open, initial]);

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Dá um nome pro tópico.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: trimmedName,
        description: description.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar tópico' : 'Novo tópico'}
      confirmLabel={initial ? 'Salvar' : 'Criar'}
      onConfirm={handleSubmit}
      confirmLoading={submitting}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nome"
          placeholder="Ex: Derivadas, Segunda Guerra Mundial..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />

        {/*
          Textarea custom (não temos componente <Textarea /> ainda — adicionar em
          ui/ se virar reincidente). Para um único uso aqui, inline é suficiente.
        */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={descId} className="font-sans text-sm font-medium text-text-muted">
            Descrição (opcional)
          </label>
          <textarea
            id={descId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que esse tópico cobre?"
            rows={3}
            className={[
              'w-full resize-none rounded-[8px] border border-border bg-surface px-3 py-2',
              'font-sans text-sm text-text placeholder:text-text-subtle',
              'outline-none transition-colors duration-150',
              'focus:border-accent focus:ring-1 focus:ring-accent',
            ].join(' ')}
          />
        </div>
      </div>
    </Modal>
  );
}
