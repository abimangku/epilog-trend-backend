import type { Trend, ClientBrandFit } from '../../types';
import { formatNumber } from '../../lib/utils';
import { useUIStore } from '../../stores/ui';

interface CompactRowProps {
  trend: Trend;
  brandFit?: ClientBrandFit;
  trendIds: string[];
  dimmed?: boolean;
}

export function CompactRow({ trend, brandFit, trendIds, dimmed = false }: CompactRowProps) {
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);

  return (
    <div
      className="rounded-lg flex items-center gap-4 p-3.5 cursor-pointer transition-colors"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-card)',
        opacity: dimmed ? 0.5 : 1,
      }}
      onClick={() => openDetailPanel(trend.id, trendIds)}
    >
      {/* Thumbnail */}
      <div className="w-14 h-14 rounded-md overflow-hidden flex-shrink-0">
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
        <h3 className="text-[13px] font-medium line-clamp-1 mb-0.5" style={{ color: 'var(--text-heading)' }}>
          {trend.title}
        </h3>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {trend.author && `@${trend.author} · `}
          {formatNumber(trend.views)} views · {trend.lifecycle_stage}
        </div>
      </div>

      {/* Score */}
      <div className="text-right flex-shrink-0">
        {brandFit ? (
          <>
            <div
              className="text-[14px] font-semibold"
              style={{ color: brandFit.fit_score >= 60 ? 'var(--brand-stella)' : 'var(--text-muted)' }}
            >
              {brandFit.fit_score} fit
            </div>
            {brandFit.content_angle && (
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {brandFit.content_angle}
              </div>
            )}
          </>
        ) : (
          <div className="text-[14px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {trend.trend_score}
          </div>
        )}
      </div>
    </div>
  );
}
