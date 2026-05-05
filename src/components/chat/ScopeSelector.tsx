import { useEffect, useRef, useState } from 'react';
import type { ChatScope, Subject, Topic } from '@/types/ipc';

interface Props {
  scope: ChatScope;
  onChange: (scope: ChatScope) => void;
  subjects: Subject[];
  topicsBySubject: Record<string, Topic[]>;
  loading?: boolean;
}

/*
  Dropdown de escopo pro chat fullscreen (v0.8.3+).

  Permite trocar entre:
  - 🌐 Global (todos os PDFs)
  - 📚 Matéria inteira (qualquer tópico dela)
  - 📁 Tópico específico

  Layout: botão único com label do escopo atual + chevron. Click abre
  painel listando todas as opções aninhadas.

  💡 Não suporta document scope (1 PDF). Esse caso de uso fica restrito ao
  TopicView (aluno entra no tópico e usa drawer pra chat).
*/
export function ScopeSelector({
  scope,
  onChange,
  subjects,
  topicsBySubject,
  loading,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentLabel = formatScopeLabel(scope, subjects, topicsBySubject);

  function handleSelect(newScope: ChatScope) {
    onChange(newScope);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className={[
          'flex items-center gap-2 rounded-[8px] border border-border bg-bg-elevated',
          'px-3 py-1.5 font-sans text-sm text-text',
          'hover:border-accent/40 transition-colors',
          'disabled:opacity-50',
        ].join(' ')}
      >
        <span className="truncate max-w-[300px]">{currentLabel}</span>
        <span className="text-xs text-text-subtle">▾</span>
      </button>

      {open && (
        <div
          className={[
            'absolute left-0 top-full z-30 mt-1 max-h-96 w-72 overflow-y-auto',
            'rounded-[10px] border border-border bg-bg-elevated shadow-lg',
            'p-1',
          ].join(' ')}
        >
          {/* Global */}
          <ScopeOption
            label="🌐 Global"
            sublabel="Todos os PDFs do app"
            selected={scope.scopeType === 'global'}
            onClick={() => handleSelect({ scopeType: 'global', scopeId: 'global' })}
          />

          {subjects.length > 0 && (
            <div className="my-1 border-t border-border" />
          )}

          {subjects.map((s) => {
            const topics = topicsBySubject[s.id] ?? [];
            return (
              <div key={s.id}>
                <ScopeOption
                  label={`${s.emoji} ${s.name}`}
                  sublabel="Matéria inteira"
                  selected={
                    scope.scopeType === 'subject' && scope.scopeId === s.id
                  }
                  onClick={() =>
                    handleSelect({ scopeType: 'subject', scopeId: s.id })
                  }
                />
                {topics.map((t) => (
                  <ScopeOption
                    key={t.id}
                    label={`└─ ${t.name}`}
                    indent
                    selected={
                      scope.scopeType === 'topic' && scope.scopeId === t.id
                    }
                    onClick={() =>
                      handleSelect({ scopeType: 'topic', scopeId: t.id })
                    }
                  />
                ))}
              </div>
            );
          })}

          {subjects.length === 0 && !loading && (
            <p className="px-3 py-2 font-sans text-xs italic text-text-subtle">
              Nenhuma matéria criada ainda. Use 🌐 Global pra cobrir todos os
              PDFs.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface OptionProps {
  label: string;
  sublabel?: string;
  selected: boolean;
  indent?: boolean;
  onClick: () => void;
}

function ScopeOption({ label, sublabel, selected, indent, onClick }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex w-full flex-col rounded-[6px] px-2 py-1.5 text-left',
        'transition-colors',
        indent ? 'pl-6' : '',
        selected
          ? 'bg-accent-soft text-accent'
          : 'text-text-muted hover:bg-surface hover:text-text',
      ].join(' ')}
    >
      <span className="font-sans text-sm">
        {selected && '✓ '}
        {label}
      </span>
      {sublabel && (
        <span className="font-sans text-[11px] text-text-subtle">{sublabel}</span>
      )}
    </button>
  );
}

/*
  Resolve o label legível do escopo atual.
*/
function formatScopeLabel(
  scope: ChatScope,
  subjects: Subject[],
  topicsBySubject: Record<string, Topic[]>,
): string {
  if (scope.scopeType === 'global') return '🌐 Global';
  if (scope.scopeType === 'subject') {
    const s = subjects.find((x) => x.id === scope.scopeId);
    return s ? `${s.emoji} ${s.name}` : '📚 Matéria';
  }
  if (scope.scopeType === 'topic') {
    for (const s of subjects) {
      const t = (topicsBySubject[s.id] ?? []).find((x) => x.id === scope.scopeId);
      if (t) return `${s.emoji} ${s.name} / ${t.name}`;
    }
    return '📁 Tópico';
  }
  // document/inline/quiz_question — não esperados aqui
  return 'Escopo';
}
