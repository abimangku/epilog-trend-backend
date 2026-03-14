import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '../components/shared/Skeleton';
import { useToast } from '../components/shared/Toast';

export function Settings() {
  const toast = useToast();
  const [triggering, setTriggering] = useState(false);

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/health');
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: pipeline } = useQuery({
    queryKey: ['pipeline-status'],
    queryFn: async () => {
      const res = await fetch('/status/pipeline');
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const handleTriggerScrape = async () => {
    setTriggering(true);
    try {
      const authSecret = prompt('Enter AUTH_SECRET to trigger scrape:');
      if (!authSecret) { setTriggering(false); return; }

      const res = await fetch('/trigger/scrape', {
        method: 'POST',
        headers: { 'x-auth-secret': authSecret },
      });
      const data = await res.json();
      if (res.ok) {
        toast.show('Scrape triggered successfully', 'success');
      } else {
        toast.show(data.error || 'Failed to trigger scrape', 'error');
      }
    } catch {
      toast.show('Failed to trigger scrape', 'error');
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="p-7 max-w-[600px]">
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Settings
        </h1>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Pipeline status and system configuration
        </p>
      </div>

      {/* System Status */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          System Status
        </div>
        {healthLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : health ? (
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <div className="flex justify-between items-center">
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Status</span>
              <span className="text-[13px] font-medium" style={{ color: health.status === 'ok' ? 'var(--brand-stella)' : 'var(--brand-hitkecoa)' }}>
                {health.status}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Supabase</span>
              <span className="text-[13px]" style={{ color: health.supabase ? 'var(--brand-stella)' : 'var(--brand-hitkecoa)' }}>
                {health.supabase ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Trends in DB</span>
              <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{health.trendsCount}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Uptime</span>
              <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                {Math.floor(health.uptime / 3600)}h {Math.floor((health.uptime % 3600) / 60)}m
              </span>
            </div>
          </div>
        ) : null}
      </section>

      {/* Pipeline */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Pipeline
        </div>
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
          {pipeline && (
            <>
              <div className="flex justify-between items-center">
                <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Status</span>
                <span className="text-[13px] font-medium" style={{ color: pipeline.running ? 'var(--brand-nyu)' : 'var(--text-muted)' }}>
                  {pipeline.running ? 'Running...' : 'Idle'}
                </span>
              </div>
              {pipeline.lastRun && (
                <div className="flex justify-between items-center">
                  <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Last run</span>
                  <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                    {new Date(pipeline.lastRun).toLocaleString('id-ID')}
                  </span>
                </div>
              )}
              {pipeline.lastRunDuration > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>Duration</span>
                  <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
                    {Math.round(pipeline.lastRunDuration / 1000)}s
                  </span>
                </div>
              )}
            </>
          )}
          <button
            onClick={handleTriggerScrape}
            disabled={triggering || pipeline?.running}
            className="w-full mt-2 px-4 py-2.5 rounded-lg text-[13px] font-medium disabled:opacity-30"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', color: 'var(--text-primary)' }}
          >
            {triggering ? 'Triggering...' : pipeline?.running ? 'Pipeline Running...' : 'Trigger Scrape'}
          </button>
        </div>
      </section>

      {/* About */}
      <section>
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          About
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
          <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
            Trend Watcher v1.0 by Epilog Creative
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Clients: Stella, HIT Kecoa, NYU (Godrej Indonesia)
          </div>
        </div>
      </section>
    </div>
  );
}
