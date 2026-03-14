import type { ClientBrandFit } from '../../types';
import { getBrandColor } from '../../lib/utils';

interface BrandFitSectionProps {
  fits: ClientBrandFit[];
}

export function BrandFitSection({ fits }: BrandFitSectionProps) {
  if (fits.length === 0) return null;

  const sorted = [...fits].sort((a, b) => b.fit_score - a.fit_score);

  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
        Brand Fit
      </h3>
      <div className="space-y-2">
        {sorted.map((fit) => {
          const color = getBrandColor(fit.brand_name);
          const dimmed = fit.fit_score < 30;

          return (
            <div
              key={fit.id}
              className="rounded-lg p-3.5"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-card)',
                opacity: dimmed ? 0.5 : 1,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: color }} />
                  <span className="text-[13px] font-medium" style={{ color: 'var(--text-heading)' }}>
                    {fit.brand_name}
                  </span>
                </div>
                <span
                  className="text-[15px] font-semibold"
                  style={{ color: fit.fit_score >= 60 ? color : 'var(--text-muted)' }}
                >
                  {fit.fit_score}
                </span>
              </div>

              {fit.entry_angle && (
                <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--text-body)' }}>
                  {fit.entry_angle}
                </p>
              )}

              {fit.content_ideas && fit.content_ideas.length > 0 && !dimmed && (
                <div className="text-[12px] leading-relaxed space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {fit.content_ideas.slice(0, 3).map((idea, i) => (
                    <div key={i}>{i + 1}. {idea}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
