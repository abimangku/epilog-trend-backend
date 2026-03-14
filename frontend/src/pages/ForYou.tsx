import { useForYou } from '../hooks/use-for-you';
import { RecommendationCard } from '../components/cards/RecommendationCard';
import { Skeleton } from '../components/shared/Skeleton';
import type { EnrichedTrend } from '../types';

function TrendSection({ title, description, trends }: { title: string; description: string; trends: EnrichedTrend[] }) {
  const trendIds = trends.map(t => t.id);
  if (trends.length === 0) return null;

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-heading)' }}>{title}</h2>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
      </div>
      <div className="space-y-2">
        {trends.map((trend) => (
          <RecommendationCard key={trend.id} trend={trend} trendIds={trendIds} />
        ))}
      </div>
    </section>
  );
}

export function ForYou() {
  const { data, isLoading } = useForYou();

  return (
    <div className="p-7 max-w-[800px]">
      <div className="mb-8">
        <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          For You
        </h1>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Curated picks based on what's working right now
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : data ? (
        <>
          <TrendSection
            title="High Potential"
            description="Strong brand fit + growing momentum"
            trends={data.high_potential}
          />
          <TrendSection
            title="Fun to Replicate"
            description="Popular formats your team can adapt"
            trends={data.fun_to_replicate}
          />
          <TrendSection
            title="Rising Quietly"
            description="Early signals worth watching"
            trends={data.rising_quietly}
          />

          {/* Audio Going Viral */}
          {data.audio_going_viral.length > 0 && (
            <section className="mb-8">
              <div className="mb-3">
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-heading)' }}>Audio Going Viral</h2>
                <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Sounds appearing across multiple trends</p>
              </div>
              <div
                className="rounded-xl divide-y"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
              >
                {data.audio_going_viral.map((audio) => (
                  <div key={audio.audio_id} className="flex items-center justify-between px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium truncate" style={{ color: 'var(--text-heading)' }}>
                        {audio.audio_title}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {audio.current_count} videos using this sound
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Empty state */}
          {data.high_potential.length === 0 && data.fun_to_replicate.length === 0 &&
           data.rising_quietly.length === 0 && data.audio_going_viral.length === 0 && (
            <div className="text-center py-20">
              <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>
                No curated picks yet
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                Recommendations appear after the pipeline processes trends
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
