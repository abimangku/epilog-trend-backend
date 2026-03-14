import { useEffect, useMemo } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { verifySession } from '../../lib/api';
import { useAuthStore } from '../../stores/auth';
import { ToastContainer } from '../shared/Toast';
import { DetailPanel } from '../detail/DetailPanel';
import { useKeyboard } from '../../hooks/use-keyboard';
import { useUIStore } from '../../stores/ui';

export function AppShell() {
  const navigate = useNavigate();
  const { authenticated, loading, setAuthenticated, setLoading } = useAuthStore();
  const { closeDetailPanel, navigateDetail, detailPanelTrendId } = useUIStore();

  const shortcuts = useMemo(() => {
    const map: Record<string, () => void> = {
      'g': () => navigate('/'),
      'e': () => navigate('/explore'),
      'f': () => navigate('/for-you'),
      's': () => navigate('/saved'),
      'p': () => navigate('/patterns'),
      '/': () => document.querySelector<HTMLInputElement>('[data-search-input]')?.focus(),
    };
    if (detailPanelTrendId) {
      map['arrowleft'] = () => navigateDetail('prev');
      map['arrowright'] = () => navigateDetail('next');
      map['escape'] = () => closeDetailPanel();
    }
    return map;
  }, [navigate, navigateDetail, closeDetailPanel, detailPanelTrendId]);

  useKeyboard(shortcuts);

  useEffect(() => {
    verifySession().then((valid) => {
      setAuthenticated(valid);
      setLoading(false);
      if (!valid) navigate('/pin');
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  if (!authenticated) return null;

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-page)' }}>
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
      <DetailPanel />
      <ToastContainer />
    </div>
  );
}
