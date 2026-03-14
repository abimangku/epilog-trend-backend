import { Bookmark, ExternalLink } from 'lucide-react';
import type { Trend, ClientBrandFit, TrendAnalysis } from '../../types';
import { formatNumber } from '../../lib/utils';
import { useUIStore } from '../../stores/ui';
import { useSaveTrend, useUnsaveTrend, useSavedItems } from '../../hooks/use-collections';

interface OpportunityCardProps {
  trend: Trend;
  brandFit?: ClientBrandFit;
  analysis?: TrendAnalysis | null;
  trendIds: string[];
}

export function OpportunityCard({ trend, brandFit, trendIds }: OpportunityCardProps) {
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const { data: savedItems } = useSavedItems();
  const saveTrend = useSaveTrend();
  const unsaveTrend = useUnsaveTrend();

  const isSaved = savedItems?.some((s) => s.trend_id === trend.id) ?? false;

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSaved) unsaveTrend.mutate(trend.id);
    else saveTrend.mutate(trend.id);
  };

  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer flex"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
      onClick={() => openDetailPanel(trend.id, trendIds)}
    >
      {/* Thumbnail */}
      <div className="w-[220px] flex-shrink-0">
        {(trend.thumbnail_storage_url || trend.thumbnail_url) ? (
          <img
            src={trend.thumbnail_storage_url || trend.thumbnail_url!}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-[11px]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-disabled)' }}
          >
            No thumbnail
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex-1 min-w-0">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-[16px] font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
            {trend.title}
          </h3>
          {brandFit && (
            <span
              className="text-[15px] font-semibold flex-shrink-0 ml-4"
              style={{ color: brandFit.fit_score >= 60 ? 'var(--brand-stella)' : 'var(--text-muted)' }}
            >
              {brandFit.fit_score} fit
            </span>
          )}
        </div>

        <div className="text-[12px] mb-3.5" style={{ color: 'var(--text-muted)' }}>
          {trend.author && `@${trend.author} · `}
          {formatNumber(trend.views)} views · {trend.lifecycle_stage}
          {trend.replication_count > 0 && ` · ${trend.replication_count} replications`}
        </div>

        {/* Entry angle */}
        {brandFit?.entry_angle && (
          <div className="mb-3.5">
            <div className="text-[11px] uppercase tracking-wider font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Entry Angle
            </div>
            <div className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>
              {brandFit.entry_angle}
            </div>
          </div>
        )}

        {/* Content ideas */}
        {brandFit?.content_ideas && brandFit.content_ideas.length > 0 && (
          <div className="mb-3.5">
            <div className="text-[11px] uppercase tracking-wider font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Content Ideas
            </div>
            <div className="text-[12px] leading-relaxed space-y-1" style={{ color: 'var(--text-secondary)' }}>
              {brandFit.content_ideas.slice(0, 3).map((idea, i) => (
                <div key={i} className="py-0.5">{i + 1}. {idea}</div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px]"
            style={{ background: 'var(--bg-input)', color: isSaved ? 'var(--brand-stella)' : 'var(--text-secondary)' }}
          >
            <Bookmark size={12} fill={isSaved ? 'currentColor' : 'none'} />
            {isSaved ? 'Saved' : 'Save'}
          </button>
          <a
            href={trend.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px]"
            style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
          >
            <ExternalLink size={12} />
            View on TikTok
          </a>
        </div>
      </div>
    </div>
  );
}
