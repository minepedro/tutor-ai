import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Botão de confirmação. Se omitido, só aparece o "Fechar". */
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm?: () => void;
  confirmLoading?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  confirmVariant = 'primary',
  onConfirm,
  confirmLoading = false,
}: Props) {
  // Fecha com Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  /*
    💡 `createPortal(jsx, target)` renderiza o JSX diretamente dentro de `target`
    no DOM real, mesmo que o componente esteja aninhado dentro de outro elemento.
    Isso garante que o modal apareça por cima de tudo (z-index funciona corretamente)
    e não seja cortado por `overflow: hidden` de um container pai.
  */
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* overlay */}
      <div className="absolute inset-0 bg-bg/80 backdrop-blur-sm" />

      {/* caixa */}
      <div
        className="relative z-10 w-full max-w-md rounded-[12px] border border-border bg-bg-elevated p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-sans text-base font-semibold text-text">{title}</h2>

        <div className="mt-3 font-sans text-sm text-text-muted">{children}</div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {confirmLabel && onConfirm && (
            <Button
              variant={confirmVariant}
              loading={confirmLoading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
