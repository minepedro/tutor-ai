import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useIPC } from '@/hooks/useIPC';
import {
  ROUTES,
  subjectViewPath,
  topicViewPath,
} from '@/lib/constants';
import type { Subject, Topic } from '@/types/ipc';

/*
  Sidebar Notion-style (v0.8.0+):

  ┌─────────────────────┐
  │ tutor.ai            │
  ├─────────────────────┤
  │ 🏠 Início           │
  │ 💬 Chat             │
  ├─────────────────────┤
  │ 📚 MATÉRIAS         │
  │   ▸ Cálculo II      │
  │   ▾ História da Arte│
  │      • Realismo     │
  │      • Romantismo   │
  │   + Nova matéria    │
  ├─────────────────────┤
  │ ⚙️ Configurações    │
  └─────────────────────┘

  Cada subject pode ser expandido pra mostrar seus tópicos.
  Estado de expansão é local — não persiste entre sessões (boa UX por
  default; pode mudar quando virar dor).
*/

export function Sidebar() {
  const api = useIPC();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [topicsBySubject, setTopicsBySubject] = useState<Record<string, Topic[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [appVersion, setAppVersion] = useState('');

  // Carrega lista de subjects no mount
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.subjects.list(),
      api.app.getVersion(),
    ]).then(([subs, version]) => {
      if (cancelled) return;
      setSubjects(subs);
      setAppVersion(version);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Quando expande um subject, carrega seus tópicos lazy
  async function toggleExpand(subjectId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
    if (!topicsBySubject[subjectId]) {
      const topics = await api.topics.listBySubject(subjectId);
      setTopicsBySubject((prev) => ({ ...prev, [subjectId]: topics }));
    }
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-bg">
      {/* Logo */}
      <div className="flex h-14 shrink-0 items-center px-5">
        <span className="font-sans text-lg font-semibold text-text">
          tutor<span className="text-accent">.ai</span>
        </span>
      </div>

      {/* Navegação principal */}
      <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-2">
        <SidebarLink to={ROUTES.HOME} icon="🏠" label="Início" exact />
        <SidebarLink to={ROUTES.CHAT} icon="💬" label="Chat" />

        {/* Seção de Matérias */}
        <div className="mt-4 mb-1 px-3">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
            Matérias
          </p>
        </div>

        {loading ? (
          <p className="px-3 py-1 font-sans text-xs text-text-subtle">Carregando…</p>
        ) : subjects.length === 0 ? (
          <p className="px-3 py-1 font-sans text-xs text-text-subtle italic">
            Nenhuma matéria ainda. Crie a 1ª na Home.
          </p>
        ) : (
          subjects.map((s) => (
            <SubjectTreeItem
              key={s.id}
              subject={s}
              topics={topicsBySubject[s.id]}
              expanded={expanded.has(s.id)}
              onToggle={() => toggleExpand(s.id)}
              onSubjectClick={() => navigate(subjectViewPath(s.id))}
              onTopicClick={(topicId) => navigate(topicViewPath(topicId))}
            />
          ))
        )}

        {/* Espaço pra Atividades (futuro) — comentado pra não confundir */}

        {/* Configurações no fim */}
        <div className="mt-auto pt-2">
          <SidebarLink to={ROUTES.SETTINGS} icon="⚙️" label="Configurações" />
        </div>
      </nav>

      {/* Rodapé */}
      <div className="border-t border-border px-5 py-2">
        <p className="font-mono text-[10px] text-text-subtle">
          v{appVersion || '...'}
        </p>
      </div>
    </aside>
  );
}

// ── Subcomponentes ────────────────────────────────────────────────────────

interface SidebarLinkProps {
  to: string;
  icon: string;
  label: string;
  exact?: boolean;
}

function SidebarLink({ to, icon, label, exact }: SidebarLinkProps) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-[8px] px-3 py-1.5',
          'font-sans text-sm transition-colors duration-150',
          isActive
            ? 'bg-accent-soft text-accent font-medium'
            : 'text-text-muted hover:bg-surface hover:text-text',
        ].join(' ')
      }
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
    </NavLink>
  );
}

interface SubjectTreeItemProps {
  subject: Subject;
  topics: Topic[] | undefined;
  expanded: boolean;
  onToggle: () => void;
  onSubjectClick: () => void;
  onTopicClick: (topicId: string) => void;
}

function SubjectTreeItem({
  subject,
  topics,
  expanded,
  onToggle,
  onSubjectClick,
  onTopicClick,
}: SubjectTreeItemProps) {
  return (
    <div className="flex flex-col">
      {/* Linha do subject */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? 'Recolher' : 'Expandir'}
          className={[
            'flex size-5 shrink-0 items-center justify-center rounded',
            'font-mono text-xs text-text-subtle',
            'hover:bg-surface hover:text-text-muted',
            'transition-colors',
          ].join(' ')}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          type="button"
          onClick={onSubjectClick}
          className={[
            'flex flex-1 items-center gap-2 rounded-[6px] px-2 py-1',
            'font-sans text-sm text-text-muted',
            'hover:bg-surface hover:text-text',
            'transition-colors text-left',
          ].join(' ')}
          title={subject.name}
        >
          <span className="text-sm leading-none">{subject.emoji}</span>
          <span className="flex-1 truncate">{subject.name}</span>
        </button>
      </div>

      {/* Tópicos (lazy) */}
      {expanded && (
        <div className="ml-5 flex flex-col gap-0.5 border-l border-border pl-2 pt-0.5">
          {topics === undefined ? (
            <p className="py-1 pl-2 font-sans text-[11px] text-text-subtle">
              carregando…
            </p>
          ) : topics.length === 0 ? (
            <p className="py-1 pl-2 font-sans text-[11px] italic text-text-subtle">
              sem tópicos
            </p>
          ) : (
            topics.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTopicClick(t.id)}
                className={[
                  'rounded px-2 py-1 text-left',
                  'font-sans text-[13px] text-text-muted',
                  'hover:bg-surface hover:text-text',
                  'transition-colors truncate',
                ].join(' ')}
                title={t.name}
              >
                {t.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
