import { Link, useLocation } from 'wouter';

export function ProjectTabs({ projectId, active }: { projectId: string; active: 'chat' | 'dashboard' }) {
  const tabs = [
    { key: 'chat', label: 'Chat', href: `/chat/${projectId}`, icon: <ChatIcon /> },
    { key: 'dashboard', label: 'Dashboard', href: `/company/${projectId}`, icon: <DashboardIcon /> },
  ];

  return (
    <div className="inline-flex rounded-lg p-0.5" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
      {tabs.map(t => (
        <Link key={t.key} href={t.href}>
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-md transition-colors"
            style={
              active === t.key
                ? { background: 'var(--surface-5)', color: 'var(--teal)' }
                : { color: 'var(--text-ghost)' }
            }
            onMouseEnter={e => { if (active !== t.key) e.currentTarget.style.color = 'var(--text-muted)'; }}
            onMouseLeave={e => { if (active !== t.key) e.currentTarget.style.color = 'var(--text-ghost)'; }}
          >
            <span className="shrink-0 opacity-80">{t.icon}</span>
            {t.label}
          </button>
        </Link>
      ))}
    </div>
  );
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3H14V11H9L6 14V11H2V3Z" />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}
