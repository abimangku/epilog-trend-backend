import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { EngagementSnapshot } from '../types';

export function useSnapshots(trendId: string | null) {
  return useQuery({
    queryKey: ['snapshots', trendId],
    queryFn: async () => {
      if (!trendId) return [];
      const { data, error } = await supabase
        .from('engagement_snapshots')
        .select('*')
        .eq('trend_id', trendId)
        .order('captured_at', { ascending: true });

      if (error) throw error;
      return data as EngagementSnapshot[];
    },
    enabled: !!trendId,
  });
}
