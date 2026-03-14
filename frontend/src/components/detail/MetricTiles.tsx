import type { Trend } from '../../types';

interface MetricTilesProps {
  trend: Trend;
}

export function MetricTiles({ trend }: MetricTilesProps) {
  const tiles = [
    { label: 'Score', value: trend.trend_score, color: 'var(--text-primary)' },
    { label: 'Engagement', value: `${(trend.engagement_rate * 100).toFixed(1)}%`, color: 'var(--text-secondary)' },
    { label: 'Velocity', value: trend.velocity_score, color: 'var(--text-secondary)' },
    { label: 'Replications', value: trend.replication_count, color: 'var(--text-secondary)' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg p-3 text-center"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
        >
          <div className="text-[16px] font-semibold" style={{ color: tile.color }}>
            {tile.value}
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  );
}
