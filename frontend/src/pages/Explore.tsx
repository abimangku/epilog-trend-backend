import { useState, useMemo } from 'react';
import { useTrends } from '../hooks/use-trends';
import { useRealtimeTrends } from '../hooks/use-realtime';
import { TrendCard } from '../components/cards/TrendCard';
import { CompactRow } from '../components/cards/CompactRow';
import { SearchInput } from '../components/filters/SearchInput';
import { FilterBar } from '../components/filters/FilterBar';
import { FilterChips } from '../components/filters/FilterChips';
import { CardSkeleton } from '../components/shared/Skeleton';
import { useUIStore } from '../stores/ui';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { LifecycleStage, Classification, ClientBrandFit } from '../types';

export function Explore() {
  useRealtimeTrends();

  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleStage | null>(null);
  const [classificationFilter, setClassificationFilter] = useState<Classification | null>(null);
  const viewMode = useUIStore((s) => s.viewMode);

  const { data: trends, isLoading } = useTrends({ days: 14, limit: 200 });

  // Filter trends
  const filtered = useMemo(() => {
    if (!trends) return [];
    return trends.filter((t) => {
      if (lifecycleFilter && t.lifecycle_stage !== lifecycleFilter) return false;
      if (classificationFilter && t.classification !== classificationFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchTitle = t.title.toLowerCase().includes(q);
        const matchAuthor = t.author?.toLowerCase().includes(q);
        const matchHashtags = t.hashtags?.some(h => h.toLowerCase().includes(q));
        if (!matchTitle && !matchAuthor && !matchHashtags) return false;
      }
      return true;
    });
  }, [trends, lifecycleFilter, classificationFilter, search]);

  const trendIds = filtered.map(t => t.id);

  // Fetch brand fits for all visible trends
  const { data: brandFits } = useQuery({
    queryKey: ['brand-fits-explore', trendIds.slice(0, 50)],
    queryFn: async () => {
      if (trendIds.length === 0) return [];
      const { data, error } = await supabase
        .from('client_brand_fit')
        .select('*')
        .in('trend_id', trendIds.slice(0, 50));
      if (error) throw error;
      return data as ClientBrandFit[];
    },
    enabled: trendIds.length > 0,
  });

  // Active filter chips
  const activeFilters: { key: string; label: string }[] = [];
  if (lifecycleFilter) activeFilters.push({ key: 'lifecycle', label: lifecycleFilter.replace(/_/g, ' ') });
  if (classificationFilter) activeFilters.push({ key: 'classification', label: classificationFilter.replace(/_/g, ' ') });

  const handleRemoveFilter = (key: string) => {
    if (key === 'lifecycle') setLifecycleFilter(null);
    if (key === 'classification') setClassificationFilter(null);
  };

  return (
    <div className="p-7">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
          Explore
        </h1>
        <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          {filtered.length} trends from the last 14 days
        </p>
      </div>

      {/* Search */}
      <div className="mb-4 max-w-md">
        <SearchInput value={search} onChange={setSearch} />
      </div>

      {/* Filters */}
      <div className="mb-4">
        <FilterBar
          lifecycleFilter={lifecycleFilter}
          classificationFilter={classificationFilter}
          onLifecycleChange={setLifecycleFilter}
          onClassificationChange={setClassificationFilter}
        />
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div className="mb-4">
          <FilterChips
            filters={activeFilters}
            onRemove={handleRemoveFilter}
            onClearAll={() => { setLifecycleFilter(null); setClassificationFilter(null); }}
          />
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-[14px] mb-1" style={{ color: 'var(--text-secondary)' }}>
            No trends match your filters
          </p>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Try adjusting your search or filters
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((trend) => (
            <TrendCard
              key={trend.id}
              trend={trend}
              brandFits={(brandFits || []).filter(f => f.trend_id === trend.id)}
              trendIds={trendIds}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2 max-w-[700px]">
          {filtered.map((trend) => {
            const fits = (brandFits || []).filter(f => f.trend_id === trend.id);
            const topFit = fits.sort((a, b) => b.fit_score - a.fit_score)[0];
            return (
              <CompactRow
                key={trend.id}
                trend={trend}
                brandFit={topFit}
                trendIds={trendIds}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
