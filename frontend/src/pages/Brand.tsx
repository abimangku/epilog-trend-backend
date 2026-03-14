import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTrends } from '../hooks/use-trends';
import { useCrossTrendSynthesis } from '../hooks/use-analysis';
import { OpportunityCard } from '../components/cards/OpportunityCard';
import { CompactRow } from '../components/cards/CompactRow';
import { Skeleton } from '../components/shared/Skeleton';
import { getBrandColor } from '../lib/utils';
import type { ClientBrandFit, ClientName } from '../types';

export function Brand() {
  const { name } = useParams<{ name: string }>();
  const brandName = (name || 'Stella') as ClientName;
  const brandColor = getBrandColor(brandName);

  const { data: trends } = useTrends({ days: 7, limit: 100 });
  const { data: synthesis } = useCrossTrendSynthesis();

  // Fetch brand fits for this brand
  const { data: brandFits, isLoading } = useQuery({
    queryKey: ['brand-fits-page', brandName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_brand_fit')
        .select('*')
        .eq('brand_name', brandName)
        .order('fit_score', { ascending: false });
      if (error) throw error;
      return data as ClientBrandFit[];
    },
  });

  // Match trends to brand fits
  const trendMap = new Map((trends || []).map(t => [t.id, t]));
  const fitsWithTrends = (brandFits || [])
    .filter(f => trendMap.has(f.trend_id))
    .map(f => ({ fit: f, trend: trendMap.get(f.trend_id)! }));

  const bestOpportunity = fitsWithTrends[0];
  const moreOpportunities = fitsWithTrends.slice(1);
  const strongFits = fitsWithTrends.filter(f => f.fit.fit_score >= 60).length;
  const allTrendIds = fitsWithTrends.map(f => f.trend.id);

  return (
    <div className="p-7 max-w-[900px]">
      {/* Brand header */}
      <div className="mb-8 flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="inline-block w-[10px] h-[10px] rounded-full" style={{ background: brandColor }} />
            <h1 className="text-[20px] font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
              {brandName}
            </h1>
          </div>
          {synthesis?.summary && (
            <p className="text-[13px] leading-relaxed max-w-[600px]" style={{ color: 'var(--text-tertiary)' }}>
              {synthesis.summary.slice(0, 200)}{synthesis.summary.length > 200 ? '...' : ''}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <div className="rounded-lg px-4 py-2.5 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <div className="text-[18px] font-semibold" style={{ color: 'var(--text-primary)' }}>{fitsWithTrends.length}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Opportunities</div>
          </div>
          <div className="rounded-lg px-4 py-2.5 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
            <div className="text-[18px] font-semibold" style={{ color: brandColor }}>{strongFits}</div>
            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Strong fit</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : fitsWithTrends.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>No opportunities for {brandName} yet</p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>Brand fit scores appear after pipeline analysis</p>
        </div>
      ) : (
        <>
          {/* Best opportunity */}
          {bestOpportunity && (
            <section className="mb-8">
              <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
                Best Opportunity Right Now
              </div>
              <OpportunityCard
                trend={bestOpportunity.trend}
                brandFit={bestOpportunity.fit}
                trendIds={allTrendIds}
              />
            </section>
          )}

          {/* More opportunities */}
          {moreOpportunities.length > 0 && (
            <section>
              <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
                More Opportunities
              </div>
              <div className="space-y-2">
                {moreOpportunities.map(({ trend, fit }) => (
                  <CompactRow
                    key={trend.id}
                    trend={trend}
                    brandFit={fit}
                    trendIds={allTrendIds}
                    dimmed={fit.fit_score < 30}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
