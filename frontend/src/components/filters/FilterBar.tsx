import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Grid3X3, List } from 'lucide-react';
import { useUIStore } from '../../stores/ui';
import type { LifecycleStage, Classification } from '../../types';

interface FilterBarProps {
  lifecycleFilter: LifecycleStage | null;
  classificationFilter: Classification | null;
  onLifecycleChange: (value: LifecycleStage | null) => void;
  onClassificationChange: (value: Classification | null) => void;
}

const lifecycleOptions: LifecycleStage[] = ['emerging', 'growing', 'peaking', 'declining', 'dead'];
const classificationOptions: Classification[] = ['noise', 'emerging_trend', 'rising_trend', 'hot_trend', 'viral'];

function Dropdown({ label, value, options, onChange, formatOption }: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
  formatOption?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const format = formatOption || ((v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
        style={{
          background: value ? 'var(--bg-input)' : 'transparent',
          border: `1px solid ${value ? 'var(--text-muted)' : 'var(--border-card)'}`,
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {value ? format(value) : label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 left-0 z-30 rounded-lg py-1 min-w-[140px] shadow-lg"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
        >
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="block w-full text-left px-3 py-1.5 text-[12px]"
            style={{ color: 'var(--text-muted)' }}
          >
            All
          </button>
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => { onChange(opt); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 text-[12px]"
              style={{ color: opt === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            >
              {format(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ lifecycleFilter, classificationFilter, onLifecycleChange, onClassificationChange }: FilterBarProps) {
  const { viewMode, setViewMode } = useUIStore();

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Dropdown
          label="Lifecycle"
          value={lifecycleFilter}
          options={lifecycleOptions}
          onChange={(v) => onLifecycleChange(v as LifecycleStage | null)}
        />
        <Dropdown
          label="Classification"
          value={classificationFilter}
          options={classificationOptions}
          onChange={(v) => onClassificationChange(v as Classification | null)}
        />
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setViewMode('grid')}
          className="p-1.5 rounded-md"
          style={{ color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          <Grid3X3 size={16} />
        </button>
        <button
          onClick={() => setViewMode('list')}
          className="p-1.5 rounded-md"
          style={{ color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          <List size={16} />
        </button>
      </div>
    </div>
  );
}
