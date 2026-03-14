import { NavLink } from 'react-router-dom';
import { useUIStore } from '../../stores/ui';
import { useUnacknowledgedCriticalCount } from '../../hooks/use-pipeline-events';
import { useLatestRun } from '../../hooks/use-pipeline-status';

const mainNav = [
  { to: '/', label: "Today's Pulse" },
  { to: '/explore', label: 'Explore' },
  { to: '/for-you', label: 'For You' },
];

const brandNav = [
  { to: '/brand/Stella', label: 'Stella', color: 'var(--brand-stella)' },
  { to: '/brand/HIT Kecoa', label: 'HIT Kecoa', color: 'var(--brand-hitkecoa)' },
  { to: '/brand/NYU', label: 'NYU', color: 'var(--brand-nyu)' },
];

const libraryNav = [
  { to: '/saved', label: 'Saved' },
  { to: '/patterns', label: 'Patterns' },
];

function SidebarLink({ to, label, color }: { to: string; label: string; color?: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-[13px] transition-colors ${isActive ? 'font-medium' : ''}`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--bg-card)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
      })}
    >
      <span className="flex items-center gap-2.5">
        {color && (
          <span
            className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
            style={{ background: color }}
          />
        )}
        {label}
      </span>
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] uppercase tracking-wider font-medium px-3 mb-1.5"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}

function getStatusDotColor(status: string | undefined | null): string {
  switch (status) {
    case 'success':
      return '#22c55e';
    case 'partial':
    case 'running':
      return '#eab308';
    case 'failed':
      return '#ef4444';
    default:
      return 'var(--text-muted)';
  }
}

function SystemLink() {
  const { data: criticalCount } = useUnacknowledgedCriticalCount();
  const { data: latestRun } = useLatestRun();
  const dotColor = getStatusDotColor(latestRun?.status);

  return (
    <NavLink
      to="/system"
      className={({ isActive }) =>
        `block rounded-lg px-3 py-2 text-[13px] transition-colors ${isActive ? 'font-medium' : ''}`
      }
      style={({ isActive }) => ({
        background: isActive ? 'var(--bg-card)' : 'transparent',
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
      })}
    >
      <span className="flex items-center gap-2.5">
        <span
          className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
          style={{ background: dotColor }}
        />
        System
        {criticalCount > 0 && (
          <span
            className="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-medium leading-none px-1.5 py-0.5"
            style={{ background: '#ef4444', color: '#ffffff' }}
          >
            {criticalCount}
          </span>
        )}
      </span>
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);

  if (collapsed) return null;

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col py-5 px-3 overflow-y-auto border-r"
      style={{ background: 'var(--bg-page)', borderColor: 'var(--border-divider)' }}
    >
      <div className="mb-7 px-3">
        <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Trend Watcher
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Epilog Creative
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 mb-5">
        {mainNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <SectionLabel>Brands</SectionLabel>
      <nav className="flex flex-col gap-0.5 mb-5">
        {brandNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <SectionLabel>Library</SectionLabel>
      <nav className="flex flex-col gap-0.5 mb-5">
        {libraryNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      <div className="mt-auto pt-3 border-t" style={{ borderColor: 'var(--border-divider)' }}>
        <SystemLink />
        <SidebarLink to="/settings" label="Settings" />
      </div>
    </aside>
  );
}
