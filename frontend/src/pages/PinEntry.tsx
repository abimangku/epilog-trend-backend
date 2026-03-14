import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { verifyPin } from '../lib/api';
import { useAuthStore } from '../stores/auth';

export function PinEntry() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyPin(pin);
      setAuthenticated(true);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid PIN');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-page)' }}>
      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Trend Watcher
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Enter PIN to continue
        </p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          autoFocus
          className="w-full rounded-lg px-4 py-3 text-lg text-center tracking-widest outline-none"
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border-input)',
            color: 'var(--text-primary)',
          }}
        />
        {error && (
          <p className="mt-3 text-sm text-center" style={{ color: 'var(--brand-hitkecoa)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={loading || pin.length < 4}
          className="w-full mt-4 rounded-lg px-4 py-3 text-sm font-medium transition-opacity disabled:opacity-30"
          style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
        >
          {loading ? 'Verifying...' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
