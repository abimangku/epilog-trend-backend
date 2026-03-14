import { useState } from 'react';
import { useSavedItems, useCollections, useCreateCollection, useDeleteCollection } from '../hooks/use-collections';
import { useTrends } from '../hooks/use-trends';
import { CompactRow } from '../components/cards/CompactRow';
import { Skeleton } from '../components/shared/Skeleton';
import { Plus, Trash2 } from 'lucide-react';
import type { Trend } from '../types';

export function Saved() {
  const { data: savedItems, isLoading: savedLoading, error: savedError, refetch: refetchSaved } = useSavedItems();
  const { data: collections } = useCollections();
  const { data: trends } = useTrends({ days: 30, limit: 200 });
  const createCollection = useCreateCollection();
  const deleteCollection = useDeleteCollection();
  const [newCollectionName, setNewCollectionName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const trendMap = new Map((trends || []).map(t => [t.id, t]));
  const savedTrends = (savedItems || [])
    .map(s => trendMap.get(s.trend_id))
    .filter((t): t is Trend => t !== undefined);
  const savedTrendIds = savedTrends.map(t => t.id);

  const handleCreate = async () => {
    if (!newCollectionName.trim()) return;
    await createCollection.mutateAsync(newCollectionName.trim());
    setNewCollectionName('');
    setShowCreate(false);
  };

  return (
    <div className="p-7 max-w-[800px]">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-[20px] font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Saved
          </h1>
          <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            {savedTrends.length} bookmarked trends · {(collections || []).length} collections
          </p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-secondary)' }}
        >
          <Plus size={14} />
          New Collection
        </button>
      </div>

      {/* Create collection form */}
      {showCreate && (
        <div className="mb-6 flex gap-2">
          <input
            type="text"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder="Collection name"
            autoFocus
            className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-input)', color: 'var(--text-primary)' }}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={!newCollectionName.trim()}
            className="px-4 py-2 rounded-lg text-[12px] font-medium disabled:opacity-30"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
          >
            Create
          </button>
        </div>
      )}

      {/* Collections */}
      {collections && collections.length > 0 && (
        <section className="mb-8">
          <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
            Collections
          </div>
          <div className="grid grid-cols-2 gap-3">
            {collections.map((col) => (
              <div
                key={col.id}
                className="rounded-xl p-4 flex justify-between items-start"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
              >
                <div>
                  <div className="text-[14px] font-medium" style={{ color: 'var(--text-heading)' }}>{col.name}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{col.item_count} items</div>
                </div>
                <button
                  onClick={() => deleteCollection.mutate(col.id)}
                  className="p-1 rounded"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Saved trends */}
      <section>
        <div className="text-[11px] uppercase tracking-wider font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          All Saved
        </div>
        {savedError ? (
          <div className="text-center py-20">
            <p className="text-[14px] mb-3" style={{ color: 'var(--text-secondary)' }}>
              Something went wrong
            </p>
            <button
              onClick={() => refetchSaved()}
              className="px-4 py-2 rounded-lg text-[12px]"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            >
              Retry
            </button>
          </div>
        ) : savedLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : savedTrends.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[14px]" style={{ color: 'var(--text-secondary)' }}>Nothing saved yet</p>
            <p className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Use the bookmark icon on any content to save it here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {savedTrends.map((trend) => (
              <CompactRow key={trend.id} trend={trend} trendIds={savedTrendIds} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
