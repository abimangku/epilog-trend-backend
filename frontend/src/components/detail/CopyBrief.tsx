import { useState } from 'react';
import { Clipboard } from 'lucide-react';
import type { Trend, TrendAnalysis, ClientBrandFit } from '../../types';

interface CopyBriefProps {
  trend: Trend;
  analysis: TrendAnalysis | null;
  fits: ClientBrandFit[];
}

export function CopyBrief({ trend, analysis, fits }: CopyBriefProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const lines: string[] = [];

    lines.push(`TREND BRIEF: ${trend.title}`);
    if (trend.author) lines.push(`Author: @${trend.author}`);
    lines.push(`Score: ${trend.trend_score} | ${trend.lifecycle_stage} | ${trend.classification}`);

    if (analysis) {
      if (analysis.summary) {
        lines.push('');
        lines.push('ANALYSIS:');
        lines.push(analysis.summary);
      }
      if (analysis.why_trending) {
        lines.push('');
        lines.push('WHY TRENDING:');
        lines.push(analysis.why_trending);
      }
    }

    const relevantFits = fits.filter((f) => f.fit_score >= 30);
    if (relevantFits.length > 0) {
      lines.push('');
      lines.push('BRAND FIT:');
      for (const fit of relevantFits) {
        lines.push(`- ${fit.brand_name} (${fit.fit_score}): ${fit.entry_angle || 'No angle'}`);
        if (fit.timing) lines.push(`  Timing: ${fit.timing}`);
      }
    }

    const brief = lines.join('\n');
    await navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium"
      style={{ background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
    >
      <Clipboard size={12} />
      {copied ? 'Copied!' : 'Copy Brief'}
    </button>
  );
}
