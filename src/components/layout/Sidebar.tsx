import { NavLink } from 'react-router-dom';
import { ROUTES } from '@/lib/constants';

const NAV_ITEMS = [
  { to: ROUTES.HOME, label: 'Início', icon: '🏠' },
  { to: ROUTES.SETTINGS, label: 'Configurações', icon: '⚙️' },
] as const;

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-bg">
      {/* Logo */}
      <div className="flex h-14 items-center px-5">
        <span className="font-sans text-lg font-semibold text-text">
          tutor<span className="text-accent">.ai</span>
        </span>
      </div>

      {/* Navegação */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === ROUTES.HOME}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-[8px] px-3 py-2',
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
        ))}
      </nav>

      {/* Rodapé da sidebar */}
      <div className="border-t border-border px-5 py-3">
        <p className="font-mono text-[10px] text-text-subtle">v0.1.0</p>
      </div>
    </aside>
  );
}
