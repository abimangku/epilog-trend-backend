import { Bookmark, ExternalLink } from 'lucide-react';
import type { Trend, ClientBrandFit } from '../../types';
import { formatNumber, timeAgo } from '../../lib/utils';
import { Badge } from '../shared/Badge';
import { BrandPill } from '../shared/BrandPill';
import { useUIStore } from '../../stores/ui';
import { useSaveTrend, useUnsaveTrend, useSavedItems } from '../../hooks/use-collections';

interface TrendCardProps {
  trend: Trend;
  brandFits?: ClientBrandFit[];
  trendIds: string[];
}

export function TrendCard({ trend, brandFits = [], trendIds }: TrendCardProps) {
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const { data: savedItems } = useSavedItems();
  const saveTrend = useSaveTrend();
  const unsaveTrend = useUnsaveTrend();

  const isSaved = savedItems?.some((s) => s.trend_id === trend.id) ?? false;
  const topFit = brandFits.sort((a, b) => b.fit_score - a.fit_score)[0];

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSaved) {
      unsaveTrend.mutate(trend.id);
    } else {
      saveTrend.mutate(trend.id);
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer transition-colors group"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      onClick={() => openDetailPanel(trend.id, trendIds)}
    >
      {/* Thumbnail */}
      {(trend.thumbnail_storage_url || trend.thumbnail_url) ? (
        <div className="aspect-[9/12] overflow-hidden">
          <img
            src={trend.thumbnail_storage_url || trend.thumbnail_url!}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>
      ) : (
        <div
          className="aspect-[9/12] flex items-center justify-center text-xs"
          style={{ background: 'var(--bg-input)', color: 'var(--text-disabled)' }}
        >
          No thumbnail
        </div>
      )}

      {/* Content */}
      <div className="p-3.5">
        <h3
          className="text-[13px] font-medium leading-snug line-clamp-2 mb-1.5"
          style={{ color: 'var(--text-heading)' }}
        >
          {trend.title}
        </h3>

        <div className="text-[11px] mb-2.5" style={{ color: 'var(--text-muted)' }}>
          {trend.author && `@${trend.author} · `}
          {formatNumber(trend.views)} views · {timeAgo(trend.scraped_at)}
        </div>

        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          <Badge type="lifecycle" value={trend.lifecycle_stage} />
          {trend.classification !== 'noise' && (
            <Badge type="classification" value={trend.classification} />
          )}
        </div>

        {/* Brand fits */}
        {topFit && topFit.fit_score >= 30 && (
          <div className="mb-2.5">
            <BrandPill brand={topFit.brand_name} score={topFit.fit_score} />
          </div>
        )}

        {/* Score + actions */}
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            {trend.trend_score}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="p-1 rounded transition-colors"
              style={{ color: isSaved ? 'var(--brand-stella)' : 'var(--text-muted)' }}
            >
              <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
            </button>
            <a
              href={trend.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
