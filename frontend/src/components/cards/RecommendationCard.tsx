import type { EnrichedTrend } from '../../types';
import { formatNumber } from '../../lib/utils';
import { Badge } from '../shared/Badge';
import { BrandPill } from '../shared/BrandPill';
import { useUIStore } from '../../stores/ui';

interface RecommendationCardProps {
  trend: EnrichedTrend;
  trendIds: string[];
}

export function RecommendationCard({ trend, trendIds }: RecommendationCardProps) {
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const topFit = trend.brand_fits?.sort((a, b) => b.fit_score - a.fit_score)[0];

  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer flex gap-4 p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      onClick={() => openDetailPanel(trend.id, trendIds)}
    >
      {/* Thumbnail */}
      <div className="w-[80px] h-[80px] rounded-lg overflow-hidden flex-shrink-0">
        {trend.thumbnail_url ? (
          <img src={trend.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-[9px]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-disabled)' }}
          >
            Thumb
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3 className="text-[13px] font-medium leading-snug line-clamp-2 mb-1" style={{ color: 'var(--text-heading)' }}>
          {trend.title}
        </h3>
        <div className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>
          {trend.author && `@${trend.author} · `}
          {formatNumber(trend.views)} views · {trend.lifecycle_stage}
        </div>
        {trend.reason && (
          <p className="text-[12px] leading-relaxed line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {trend.reason}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Badge type="lifecycle" value={trend.lifecycle_stage} />
          {topFit && <BrandPill brand={topFit.brand_name} score={topFit.fit_score} />}
        </div>
      </div>

      {/* Score */}
      <div className="flex-shrink-0 text-right">
        <div
          className="text-[16px] font-semibold"
          style={{ color: trend.trend_score >= 60 ? 'var(--brand-stella)' : 'var(--text-secondary)' }}
        >
          {trend.trend_score}
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>score</div>
      </div>
    </div>
  );
}
