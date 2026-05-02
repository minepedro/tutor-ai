import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import type { CreateSubjectInput, Subject } from '@/types/ipc';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chamado com os dados quando o usuário confirma. Pode lançar para abortar o close. */
  onSubmit: (input: CreateSubjectInput) => Promise<void>;
  /** Se passado, modo edição: pré-preenche os campos e muda o título/botão. */
  initial?: Subject;
}

const EMOJI_PRESETS = ['📚', '📖', '✏️', '🧮', '🔬', '🧪', '🌍', '⚗️', '📐', '🎨', '💻', '🎵'];

const COLOR_PRESETS = [
  '#7c5cfc', // accent (roxo)
  '#06b6d4', // cyan
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#f97316', // orange
];

export function SubjectModal({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📚');
  const [color, setColor] = useState('#7c5cfc');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /*
    💡 Reseta o form sempre que o modal abre. Sem isso, o estado das aberturas
    anteriores vazaria — abrir "criar" depois de "editar" mostraria os campos
    do que estava sendo editado.
  */
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setEmoji(initial?.emoji ?? '📚');
    setColor(initial?.color ?? '#7c5cfc');
    setError('');
    setSubmitting(false);
  }, [open, initial]);

  async function handleSubmit() {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Dá um nome pra matéria.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ name: trimmed, emoji, color });
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
      title={initial ? 'Editar matéria' : 'Nova matéria'}
      confirmLabel={initial ? 'Salvar' : 'Criar'}
      onConfirm={handleSubmit}
      confirmLoading={submitting}
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nome"
          placeholder="Ex: Cálculo I, História do Brasil..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
        />

        <div className="flex flex-col gap-2">
          <label className="font-sans text-sm font-medium text-text-muted">
            Emoji
          </label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setEmoji(preset)}
                aria-label={`Selecionar emoji ${preset}`}
                aria-pressed={emoji === preset}
                className={[
                  'flex size-9 items-center justify-center rounded-md text-lg',
                  'transition-colors',
                  emoji === preset
                    ? 'bg-accent/15 ring-1 ring-accent'
                    : 'hover:bg-surface',
                ].join(' ')}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="font-sans text-sm font-medium text-text-muted">
            Cor
          </label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-label={`Selecionar cor ${preset}`}
                aria-pressed={color === preset}
                style={{ backgroundColor: preset }}
                className={[
                  'size-7 rounded-full transition-transform duration-150',
                  color === preset
                    ? 'ring-2 ring-text ring-offset-2 ring-offset-bg-elevated'
                    : 'hover:scale-110',
                ].join(' ')}
              />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
