import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { useSnapshots } from '../../hooks/use-snapshots';

interface EngagementSparklineProps {
  trendId: string;
}

export function EngagementSparkline({ trendId }: EngagementSparklineProps) {
  const { data: snapshots } = useSnapshots(trendId);

  if (!snapshots || snapshots.length < 2) return null;

  const chartData = snapshots.map((s) => ({ views: s.views }));

  return (
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={chartData}>
        <Area
          type="monotone"
          dataKey="views"
          stroke="var(--brand-stella)"
          strokeOpacity={0.8}
          fill="var(--brand-stella)"
          fillOpacity={0.2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
