import { useQuery } from '@tanstack/react-query';
import { useTrends } from '../hooks/use-trends';
import { useCrossTrendSynthesis } from '../hooks/use-analysis';
import { useAudioPatterns, useFormatPatterns } from '../hooks/use-patterns';
import { useRealtimeTrends } from '../hooks/use-realtime';
import { useLatestRun } from '../hooks/use-pipeline-status';
import { OpportunityCard } from '../components/cards/OpportunityCard';
import { Onboarding } from '../components/shared/Onboarding';
import { Skeleton } from '../components/shared/Skeleton';
import { supabase } from '../lib/supabase';
import type { ClientBrandFit } from '../types';

export function Pulse() {
  useRealtimeTrends();

  const { data: latestRun, isLoading: runLoading } = useLatestRun();
  const { data: trends, isLoading: trendsLoading, error: trendsError, refetch: refetchTrends } = useTrends({ days: 7, limit: 50 });
  const { data: synthesis, isLoading: synthLoading } = useCrossTrendSynthesis();
  const { data: audioPatterns } = useAudioPatterns(6);
  const { data: formatPatterns } = useFormatPatterns(14);

  // Get top 3 opportunities (growing/peaking, highest score)
  const topTrends = (trends || [])
    .filter(t => ['growing', 'peaking'].includes(t.lifecycle_stage))
    .slice(0, 3);

  const topTrendIds = topTrends.map(t => t.id);

  // Fetch brand fits for top trends
  const { data: brandFits } = useQuery({
    queryKey: ['brand-fits-pulse', topTrendIds],
    queryFn: async () => {
      if (topTrendIds.length === 0) return [];
      const { data, error } = await supabase
        .from('client_brand_fit')
        .select('*')
        .in('trend_id', topTrendIds);
      if (error) throw error;
      return data as ClientBrandFit[];
    },
    enabled: topTrendIds.length > 0,
  });

  const allTrendIds = (trends || []).map(t => t.id);

  const synthesisText = synthesis?.summary || null;
  const keyInsights = synthesis?.key_insights || [];

  return (
    <div className="p-7 max-w-[900px]">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Today's Pulse
        </h1>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          What's happening on Indonesian TikTok right now
        </p>
      </div>

      {trendsError ? (
        <div className="text-center py-20">
          <p className="text-[14px] mb-3" style={{ color: 'var(--text-secondary)' }}>
            Something went wrong
          </p>
          <button
            onClick={() => refetchTrends()}
            className="px-4 py-2 rounded-lg text-[12px]"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
          >
            Retry
          </button>
        </div>
      ) : !trendsLoading && (!trends || trends.length === 0) ? (
        !runLoading && !latestRun ? (
          <Onboarding />
        ) : (
          <div className="text-center py-20">
            <p className="text-[14px] mb-1" style={{ color: 'var(--text-secondary)' }}>
              No trends yet — waiting for first scan
            </p>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              The pipeline will populate this page after the first scrape
            </p>
          </div>
        )
      ) : (
        <>
      {/* Section 1: Cultural Snapshot */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Cultural Snapshot
        </div>
        {synthLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" variant="text" />
            <Skeleton className="h-4 w-3/4" variant="text" />
          </div>
        ) : synthesisText ? (
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            <p className="text-[14px] leading-relaxed mb-4" style={{ color: 'var(--text-body)' }}>
              {synthesisText}
            </p>
            {keyInsights.length > 0 && (
              <ul className="text-[13px] leading-relaxed space-y-1.5" style={{ color: 'var(--text-secondary)' }}>
                {keyInsights.slice(0, 4).map((insight, i) => (
                  <li key={i}>• {insight}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No synthesis available yet. Run a pipeline scrape to generate insights.
          </p>
        )}
      </section>

      {/* Section 2: Best Opportunities */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Best Opportunities
        </div>
        {trendsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : topTrends.length > 0 ? (
          <div className="space-y-3">
            {topTrends.map((trend) => {
              const fits = (brandFits || []).filter(f => f.trend_id === trend.id);
              const topFit = fits.sort((a, b) => b.fit_score - a.fit_score)[0];
              return (
                <OpportunityCard
                  key={trend.id}
                  trend={trend}
                  brandFit={topFit}
                  trendIds={allTrendIds}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No growing or peaking trends found this week.
          </p>
        )}
      </section>

      {/* Section 3: Trending Audio */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Trending Audio
        </div>
        {audioPatterns && audioPatterns.length > 0 ? (
          <div
            className="rounded-xl divide-y"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            {audioPatterns.slice(0, 5).map((audio, i) => (
              <div key={audio.audio_id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-[12px] font-medium w-5 text-center" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-heading)' }}>
                      {audio.audio_title}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {audio.current_count} videos
                    </div>
                  </div>
                </div>
                <div
                  className="text-[12px] font-semibold flex-shrink-0"
                  style={{
                    color: audio.status === 'rising'
                      ? 'var(--brand-stella)'
                      : audio.status === 'declining'
                      ? 'var(--brand-hitkecoa)'
                      : 'var(--text-muted)',
                  }}
                >
                  {audio.growth_pct > 0 ? '+' : ''}{audio.growth_pct}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No audio data available yet.
          </p>
        )}
      </section>

      {/* Section 4: Format Pulse */}
      <section className="mb-8">
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Format Pulse
        </div>
        {formatPatterns && formatPatterns.length > 0 ? (
          <div
            className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
          >
            {formatPatterns.slice(0, 5).map((fmt) => (
              <div key={fmt.format} className="flex items-center gap-3">
                <div className="text-[12px] w-24 capitalize flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {fmt.format}
                </div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(fmt.percentage, 100)}%`,
                      background: 'var(--brand-stella)',
                      opacity: 0.6,
                    }}
                  />
                </div>
                <div className="text-[11px] w-10 text-right" style={{ color: 'var(--text-muted)' }}>
                  {fmt.percentage}%
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
            No format data available yet.
          </p>
        )}
      </section>
        </>
      )}
    </div>
  );
}
