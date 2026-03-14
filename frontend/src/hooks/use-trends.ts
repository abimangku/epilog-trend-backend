import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Trend } from '../types';

export function useTrends(options?: { days?: number; limit?: number }) {
  const days = options?.days ?? 7;
  const limit = options?.limit ?? 100;

  return useQuery({
    queryKey: ['trends', days, limit],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('trends')
        .select('*')
        .gte('scraped_at', since)
        .order('trend_score', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as Trend[];
    },
  });
}

export function useTrend(trendId: string | null) {
  return useQuery({
    queryKey: ['trend', trendId],
    queryFn: async () => {
      if (!trendId) return null;
      const { data, error } = await supabase
        .from('trends')
        .select('*')
        .eq('id', trendId)
        .single();

      if (error) throw error;
      return data as Trend;
    },
    enabled: !!trendId,
  });
}
