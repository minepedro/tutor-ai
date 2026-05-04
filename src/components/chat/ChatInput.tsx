import { useState, type KeyboardEvent } from 'react';

interface Props {
  /** Disparado ao enviar — recebe texto trimmed. */
  onSend: (content: string) => void;
  disabled: boolean;
  /** Texto do placeholder. */
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState('');

  function handleSend() {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    /*
      Enter envia, Shift+Enter quebra linha. Convenção do Slack/Discord/etc.
      No Electron isso funciona normal — não há diferença entre Enter e
      keypad-Enter pra esse caso.
    */
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-bg p-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder ?? 'Pergunte algo sobre seu material…'}
        rows={2}
        className={[
          'flex-1 resize-none rounded-[8px] border border-border bg-surface px-3 py-2',
          'font-sans text-sm text-text placeholder:text-text-subtle',
          'outline-none transition-colors duration-150',
          'focus:border-accent focus:ring-1 focus:ring-accent',
          'disabled:opacity-40',
        ].join(' ')}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || value.trim().length === 0}
        className={[
          'flex size-10 shrink-0 items-center justify-center rounded-[8px]',
          'bg-accent text-white shadow-sm shadow-accent/30',
          'transition-all duration-150',
          'hover:bg-accent-hover active:scale-95',
          'disabled:cursor-not-allowed disabled:opacity-40',
        ].join(' ')}
        aria-label="Enviar"
      >
        ↑
      </button>
    </div>
  );
}
