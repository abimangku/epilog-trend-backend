import { getLifecycleColor, getClassificationColor, formatClassification, formatLifecycle } from '../../lib/utils';

interface BadgeProps {
  type: 'lifecycle' | 'classification';
  value: string;
}

export function Badge({ type, value }: BadgeProps) {
  const color = type === 'lifecycle' ? getLifecycleColor(value) : getClassificationColor(value);
  const label = type === 'lifecycle' ? formatLifecycle(value) : formatClassification(value);

  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}
