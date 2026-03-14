import { AnimatePresence, motion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, Bookmark, ExternalLink } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import { useTrend } from '../../hooks/use-trends';
import { useAnalysis } from '../../hooks/use-analysis';
import { useBrandFits } from '../../hooks/use-brand-fit';
import { useSavedItems, useSaveTrend, useUnsaveTrend } from '../../hooks/use-collections';
import { useKeyboard } from '../../hooks/use-keyboard';
import { formatNumber, timeAgo } from '../../lib/utils';
import { Badge } from '../shared/Badge';
import { VideoEmbed } from './VideoEmbed';
import { MetricTiles } from './MetricTiles';
import { BrandFitSection } from './BrandFitSection';
import { UserAssessment } from './UserAssessment';

export function DetailPanel() {
  const { detailPanelTrendId, detailPanelTrendIds, closeDetailPanel, navigateDetail } = useUIStore();
  const { data: trend } = useTrend(detailPanelTrendId);
  const { data: analysis } = useAnalysis(detailPanelTrendId);
  const { data: brandFits } = useBrandFits(detailPanelTrendId);
  const { data: savedItems } = useSavedItems();
  const saveTrend = useSaveTrend();
  const unsaveTrend = useUnsaveTrend();

  const isSaved = savedItems?.some((s) => s.trend_id === detailPanelTrendId) ?? false;
  const currentIdx = detailPanelTrendId ? detailPanelTrendIds.indexOf(detailPanelTrendId) : -1;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx < detailPanelTrendIds.length - 1;

  useKeyboard({
    escape: closeDetailPanel,
    arrowleft: () => hasPrev && navigateDetail('prev'),
    arrowright: () => hasNext && navigateDetail('next'),
    b: () => {
      if (detailPanelTrendId) {
        if (isSaved) unsaveTrend.mutate(detailPanelTrendId);
        else saveTrend.mutate(detailPanelTrendId);
      }
    },
  });

  const handleSave = () => {
    if (!detailPanelTrendId) return;
    if (isSaved) unsaveTrend.mutate(detailPanelTrendId);
    else saveTrend.mutate(detailPanelTrendId);
  };

  return (
    <AnimatePresence>
      {detailPanelTrendId && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black"
            onClick={closeDetailPanel}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[520px] overflow-y-auto"
            style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-divider)' }}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-4" style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-divider)' }}>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => navigateDetail('prev')}
                  disabled={!hasPrev}
                  className="p-1.5 rounded-md disabled:opacity-20"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {currentIdx + 1} / {detailPanelTrendIds.length}
                </span>
                <button
                  onClick={() => navigateDetail('next')}
                  disabled={!hasNext}
                  className="p-1.5 rounded-md disabled:opacity-20"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  className="p-1.5 rounded-md"
                  style={{ color: isSaved ? 'var(--brand-stella)' : 'var(--text-secondary)' }}
                >
                  <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} />
                </button>
                {trend?.url && (
                  <a
                    href={trend.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-md"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ExternalLink size={16} />
                  </a>
                )}
                <button
                  onClick={closeDetailPanel}
                  className="p-1.5 rounded-md"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {trend ? (
              <div className="p-5 space-y-6">
                {/* Video embed */}
                <VideoEmbed url={trend.video_embed_url || trend.url} />

                {/* Title + meta */}
                <div>
                  <h2 className="text-[17px] font-semibold leading-snug mb-2" style={{ color: 'var(--text-primary)' }}>
                    {trend.title}
                  </h2>
                  <div className="text-[12px] mb-3" style={{ color: 'var(--text-muted)' }}>
                    {trend.author && `@${trend.author} · `}
                    {formatNumber(trend.views)} views · {timeAgo(trend.scraped_at)}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <Badge type="lifecycle" value={trend.lifecycle_stage} />
                    {trend.classification !== 'noise' && (
                      <Badge type="classification" value={trend.classification} />
                    )}
                  </div>
                </div>

                {/* Metrics */}
                <MetricTiles trend={trend} />

                {/* AI Analysis */}
                {analysis && (
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
                      AI Analysis
                    </h3>
                    {analysis.summary && (
                      <p className="text-[13px] leading-relaxed mb-3" style={{ color: 'var(--text-body)' }}>
                        {analysis.summary}
                      </p>
                    )}
                    {analysis.why_trending && (
                      <div className="mb-3">
                        <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Why trending</div>
                        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-body)' }}>{analysis.why_trending}</p>
                      </div>
                    )}
                    {analysis.key_insights && analysis.key_insights.length > 0 && (
                      <div className="mb-3">
                        <div className="text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Key insights</div>
                        <ul className="text-[13px] leading-relaxed space-y-1" style={{ color: 'var(--text-body)' }}>
                          {analysis.key_insights.map((insight, i) => (
                            <li key={i}>• {insight}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Brand fit */}
                <BrandFitSection fits={brandFits || []} />

                {/* Hashtags */}
                {trend.hashtags && trend.hashtags.length > 0 && (
                  <div>
                    <h3 className="text-[11px] uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                      Hashtags
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {trend.hashtags.map((tag, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded text-[11px]"
                          style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* User assessment */}
                <UserAssessment trendId={trend.id} />
              </div>
            ) : (
              <div className="p-5 text-[13px]" style={{ color: 'var(--text-muted)' }}>
                Loading...
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
