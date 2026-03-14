interface ScoreIndicatorProps {
  score: number;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreIndicator({ score, label, size = 'md' }: ScoreIndicatorProps) {
  const color = score >= 70 ? 'var(--brand-stella)' : score >= 40 ? 'var(--text-secondary)' : 'var(--text-muted)';
  const fontSize = size === 'sm' ? 'text-xs' : size === 'lg' ? 'text-xl' : 'text-sm';

  return (
    <div className="text-right">
      <div className={`${fontSize} font-semibold`} style={{ color }}>
        {score}
      </div>
      {label && (
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {label}
        </div>
      )}
    </div>
  );
}
