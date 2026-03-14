import { getBrandColor } from '../../lib/utils';

interface BrandPillProps {
  brand: string;
  score?: number;
  size?: 'sm' | 'md';
}

export function BrandPill({ brand, score, size = 'sm' }: BrandPillProps) {
  const color = getBrandColor(brand);
  const textSize = size === 'sm' ? 'text-[11px]' : 'text-[13px]';

  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize}`}>
      <span
        className="inline-block w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: color }}
      />
      <span style={{ color: 'var(--text-secondary)' }}>{brand}</span>
      {score !== undefined && (
        <span
          className="font-semibold"
          style={{ color: score >= 60 ? color : 'var(--text-muted)' }}
        >
          {score}
        </span>
      )}
    </span>
  );
}
