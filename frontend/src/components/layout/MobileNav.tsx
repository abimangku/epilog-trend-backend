import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Zap, Compass, Sparkles, Tag, MoreHorizontal, Bookmark, BarChart2, Settings, X } from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Pulse', icon: Zap },
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/for-you', label: 'For You', icon: Sparkles },
  { to: '/brand/Stella', label: 'Brands', icon: Tag },
];

const MORE_LINKS = [
  { to: '/saved', label: 'Saved', icon: Bookmark },
  { to: '/patterns', label: 'Patterns', icon: BarChart2 },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function MobileNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <>
      {/* Bottom navigation bar — visible only on screens < 768px */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center"
        style={{
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border-divider)',
          height: '64px',
        }}
      >
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 no-underline"
            style={({ isActive }) => ({
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
            })}
          >
            <Icon size={20} strokeWidth={1.75} />
            <span style={{ fontSize: '10px', lineHeight: '14px' }}>{label}</span>
          </NavLink>
        ))}

        {/* More tab — opens Dialog sheet */}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 border-0 bg-transparent cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
        >
          <MoreHorizontal size={20} strokeWidth={1.75} />
          <span style={{ fontSize: '10px', lineHeight: '14px' }}>More</span>
        </button>
      </nav>

      {/* "More" bottom sheet */}
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Overlay
            className="md:hidden fixed inset-0 z-50"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          />
          <Dialog.Content
            className="md:hidden fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl outline-none"
            style={{
              background: 'var(--bg-card)',
              borderTop: '1px solid var(--border-divider)',
              padding: '24px 16px 40px',
            }}
          >
            {/* Handle bar */}
            <div
              className="mx-auto mb-6 rounded-full"
              style={{ width: '40px', height: '4px', background: 'var(--border-divider)' }}
            />

            <Dialog.Title
              style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '16px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
            >
              More
            </Dialog.Title>

            <ul className="list-none m-0 p-0 flex flex-col gap-1">
              {MORE_LINKS.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      navigate(to);
                    }}
                    className="w-full flex items-center gap-3 rounded-lg border-0 bg-transparent cursor-pointer text-left"
                    style={{
                      color: 'var(--text-primary)',
                      padding: '12px',
                      fontSize: '15px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-page)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Icon size={20} strokeWidth={1.75} style={{ color: 'var(--text-secondary)' }} />
                    {label}
                  </button>
                </li>
              ))}
            </ul>

            <Dialog.Close asChild>
              <button
                className="absolute top-4 right-4 flex items-center justify-center rounded-full border-0 bg-transparent cursor-pointer"
                style={{ color: 'var(--text-muted)', width: '32px', height: '32px' }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
