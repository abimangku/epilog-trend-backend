import { useState } from 'react';
import { useFormatPatterns, useAudioPatterns } from '../hooks/use-patterns';
import { useTrends } from '../hooks/use-trends';
import { Skeleton } from '../components/shared/Skeleton';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export function Patterns() {
  const [days, setDays] = useState(14);
  const { data: formatPatterns, isLoading: formatsLoading, error: formatsError, refetch: refetchFormats } = useFormatPatterns(days);
  const { data: audioPatterns, isLoading: audioLoading, error: audioError, refetch: refetchAudio } = useAudioPatterns(6);
  const { data: trends } = useTrends({ days, limit: 200 });

  // Calculate lifecycle distribution from trends
  const lifecycleDist = (trends || []).reduce<Record<string, number>>((acc, t) => {
    acc[t.lifecycle_stage] = (acc[t.lifecycle_stage] || 0) + 1;
    return acc;
  }, {});

  const lifecycleData = Object.entries(lifecycleDist).map(([stage, count]) => ({ stage, count }));

  const lifecycleColors: Record<string, string> = {
    emerging: '#3b82f6',
    growing: '#22c55e',
    peaking: '#f59e0b',
    declining: '#525252',
    dead: '#404040',
  };

  return (
    <div className="p-7 max-w-[900px]">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Patterns
          </h1>
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            Content format and engagement patterns
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-3 py-1.5 rounded-lg text-[12px]"
              style={{
                background: days === d ? 'var(--bg-card)' : 'transparent',
                border: `1px solid ${days === d ? 'var(--border-card)' : 'transparent'}`,
                color: days === d ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Format Distribution */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Format Distribution
        </div>
        {formatsError ? (
          <div className="text-center py-20">
            <p className="text-[14px] mb-3" style={{ color: 'var(--text-secondary)' }}>
              Something went wrong
            </p>
            <button
              onClick={() => refetchFormats()}
              className="px-4 py-2 rounded-lg text-[12px]"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            >
              Retry
            </button>
          </div>
        ) : formatsLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : formatPatterns && formatPatterns.length > 0 ? (
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={formatPatterns.slice(0, 8)} layout="vertical" margin={{ left: 80 }}>
                <XAxis type="number" tick={{ fill: '#525252', fontSize: 11 }} />
                <YAxis
                  dataKey="format"
                  type="category"
                  tick={{ fill: '#a3a3a3', fontSize: 12 }}
                  width={75}
                />
                <Tooltip
                  contentStyle={{ background: '#1c1c1c', border: '1px solid #262626', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#f5f5f5' }}
                  itemStyle={{ color: '#a3a3a3' }}
                />
                <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No format data available</p>
        )}
      </section>

      {/* Lifecycle Distribution */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Lifecycle Distribution
        </div>
        {lifecycleData.length > 0 ? (
          <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={lifecycleData}>
                <XAxis dataKey="stage" tick={{ fill: '#a3a3a3', fontSize: 11 }} />
                <YAxis tick={{ fill: '#525252', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1c1c1c', border: '1px solid #262626', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ color: '#f5f5f5' }}
                  itemStyle={{ color: '#a3a3a3' }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {lifecycleData.map((entry) => (
                    <Cell key={entry.stage} fill={lifecycleColors[entry.stage] || '#525252'} opacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No lifecycle data available</p>
        )}
      </section>

      {/* Audio Momentum */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Audio Momentum
        </div>
        {audioError ? (
          <div className="text-center py-20">
            <p className="text-[14px] mb-3" style={{ color: 'var(--text-secondary)' }}>
              Something went wrong
            </p>
            <button
              onClick={() => refetchAudio()}
              className="px-4 py-2 rounded-lg text-[12px]"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            >
              Retry
            </button>
          </div>
        ) : audioLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : audioPatterns && audioPatterns.length > 0 ? (
          <div className="rounded-xl divide-y" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            {audioPatterns.slice(0, 10).map((audio, i) => (
              <div key={audio.audio_id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[12px] font-medium w-5 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-heading)' }}>
                      {audio.audio_title}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {audio.current_count} recent · {audio.previous_count} prior
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[11px] px-2 py-0.5 rounded"
                    style={{
                      background: audio.status === 'rising' ? 'rgba(34,197,94,0.15)' : audio.status === 'declining' ? 'rgba(239,68,68,0.15)' : 'var(--bg-input)',
                      color: audio.status === 'rising' ? '#22c55e' : audio.status === 'declining' ? '#ef4444' : 'var(--text-muted)',
                    }}
                  >
                    {audio.status}
                  </span>
                  <span
                    className="text-[12px] font-semibold w-12 text-right"
                    style={{ color: audio.growth_pct > 0 ? '#22c55e' : audio.growth_pct < 0 ? '#ef4444' : 'var(--text-muted)' }}
                  >
                    {audio.growth_pct > 0 ? '+' : ''}{audio.growth_pct}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No audio data available</p>
        )}
      </section>
    </div>
  );
}
