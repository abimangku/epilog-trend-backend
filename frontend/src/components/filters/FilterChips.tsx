import { X } from 'lucide-react';

interface FilterChipsProps {
  filters: { key: string; label: string }[];
  onRemove: (key: string) => void;
  onClearAll?: () => void;
}

export function FilterChips({ filters, onRemove, onClearAll }: FilterChipsProps) {
  if (filters.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {filters.map((f) => (
        <button
          key={f.key}
          onClick={() => onRemove(f.key)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors"
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-card)',
          }}
        >
          {f.label}
          <X size={10} />
        </button>
      ))}
      {onClearAll && filters.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-[11px] px-2 py-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
