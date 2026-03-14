import { usePipelineRuns, useLatestRun } from '../hooks/use-pipeline-status';
import { usePipelineEvents } from '../hooks/use-pipeline-events';
import { useSchedules, useUpdateSchedule } from '../hooks/use-schedules';
import { Skeleton } from '../components/shared/Skeleton';

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return '--';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const statusColors: Record<string, string> = {
  success: '#22c55e',
  partial: '#eab308',
  failed: '#ef4444',
  running: '#3b82f6',
};

const severityColors: Record<string, string> = {
  info: '#6b7280',
  warning: '#eab308',
  critical: '#ef4444',
};

export function SystemStatus() {
  const { data: latestRun, isLoading: latestLoading } = useLatestRun();
  const { data: runs, isLoading: runsLoading } = usePipelineRuns(10);
  const { data: events, isLoading: eventsLoading } = usePipelineEvents(undefined, 30);
  const { data: schedules, isLoading: schedulesLoading } = useSchedules();
  const updateSchedule = useUpdateSchedule();

  const isRunning = latestRun?.status === 'running';

  return (
    <div className="p-7 max-w-[900px]">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          System Status
        </h1>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Pipeline health, run history, and schedule configuration
        </p>
      </div>

      {/* Section 1: Status Header */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Current Status
        </div>
        {latestLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            {/* Status indicator */}
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  background: isRunning ? statusColors.running : (latestRun ? statusColors[latestRun.status] || '#6b7280' : '#6b7280'),
                  animation: isRunning ? 'pulse 2s ease-in-out infinite' : undefined,
                }}
              />
              <span className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {isRunning ? 'Pipeline Running' : 'Pipeline Idle'}
              </span>
              {latestRun && !isRunning && (
                <span
                  className="ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: `${statusColors[latestRun.status]}20`,
                    color: statusColors[latestRun.status],
                  }}
                >
                  {latestRun.status}
                </span>
              )}
            </div>

            {/* Last run info */}
            {latestRun && (
              <>
                <div className="text-[12px] mb-4" style={{ color: 'var(--text-muted)' }}>
                  Last run: {timeAgo(latestRun.started_at)}
                  {latestRun.completed_at && ` (took ${formatDuration(latestRun.started_at, latestRun.completed_at)})`}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {latestRun.videos_scraped}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Scraped</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {latestRun.videos_analyzed}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Analyzed</div>
                  </div>
                  <div className="text-center">
                    <div
                      className="text-[20px] font-semibold"
                      style={{ color: latestRun.videos_failed > 0 ? statusColors.failed : 'var(--text-primary)' }}
                    >
                      {latestRun.videos_failed}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Errors</div>
                  </div>
                </div>
              </>
            )}

            {!latestRun && (
              <div className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
                No pipeline runs recorded yet.
              </div>
            )}
          </div>
        )}
      </section>

      {/* Section 2: Recent Runs */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Recent Runs
        </div>
        {runsLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : runs && runs.length > 0 ? (
          <div
            className="rounded-xl divide-y overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            {/* Header row */}
            <div className="grid grid-cols-[1fr_80px_70px_70px_60px] gap-2 px-4 py-2.5">
              <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: 'var(--text-muted)' }}>Time</span>
              <span className="text-[11px] uppercase tracking-wider font-medium text-center" style={{ color: 'var(--text-muted)' }}>Status</span>
              <span className="text-[11px] uppercase tracking-wider font-medium text-center" style={{ color: 'var(--text-muted)' }}>Scraped</span>
              <span className="text-[11px] uppercase tracking-wider font-medium text-center" style={{ color: 'var(--text-muted)' }}>Analyzed</span>
              <span className="text-[11px] uppercase tracking-wider font-medium text-center" style={{ color: 'var(--text-muted)' }}>Errors</span>
            </div>
            {runs.map((run) => (
              <div
                key={run.id}
                className="grid grid-cols-[1fr_80px_70px_70px_60px] gap-2 px-4 py-2.5 items-center"
                style={{ borderColor: 'var(--border-divider)' }}
              >
                <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  {timeAgo(run.started_at)}
                </span>
                <div className="flex justify-center">
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: `${statusColors[run.status]}20`,
                      color: statusColors[run.status],
                      animation: run.status === 'running' ? 'pulse 2s ease-in-out infinite' : undefined,
                    }}
                  >
                    {run.status}
                  </span>
                </div>
                <span className="text-[12px] text-center" style={{ color: 'var(--text-primary)' }}>{run.videos_scraped}</span>
                <span className="text-[12px] text-center" style={{ color: 'var(--text-primary)' }}>{run.videos_analyzed}</span>
                <span
                  className="text-[12px] text-center"
                  style={{ color: run.videos_failed > 0 ? statusColors.failed : 'var(--text-primary)' }}
                >
                  {run.videos_failed}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No runs recorded yet.
            </p>
          </div>
        )}
      </section>

      {/* Section 3: Activity Feed */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Activity Feed
        </div>
        {eventsLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : events && events.length > 0 ? (
          <div
            className="rounded-xl divide-y overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 px-4 py-2.5"
                style={{ borderColor: 'var(--border-divider)' }}
              >
                <div
                  className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: severityColors[event.severity] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {event.stage}
                    </span>
                    <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(event.created_at)}
                    </span>
                  </div>
                  <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                    {event.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No events recorded yet.
            </p>
          </div>
        )}
      </section>

      {/* Section 4: Schedule Config */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Schedule Configuration
        </div>
        {schedulesLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : schedules && schedules.length > 0 ? (
          <div
            className="rounded-xl divide-y overflow-hidden"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex items-center justify-between px-4 py-3"
                style={{ borderColor: 'var(--border-divider)' }}
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                    {schedule.label}
                  </div>
                  <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                    <span>Every {schedule.interval_minutes}m</span>
                    <span style={{ color: 'var(--border-divider)' }}>|</span>
                    <span style={{ color: schedule.ai_analysis_enabled ? '#22c55e' : 'var(--text-muted)' }}>
                      AI {schedule.ai_analysis_enabled ? 'On' : 'Off'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => updateSchedule.mutate({ id: schedule.id, update: { enabled: !schedule.enabled } })}
                  className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                  style={{
                    background: schedule.enabled ? 'var(--accent)' : 'var(--bg-hover)',
                  }}
                  aria-label={`${schedule.enabled ? 'Disable' : 'Enable'} ${schedule.label}`}
                >
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                    style={{
                      background: 'white',
                      left: schedule.enabled ? '22px' : '2px',
                    }}
                  />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              No schedules configured.
            </p>
          </div>
        )}
      </section>

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
