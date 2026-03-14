import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TrendAnalysis } from '../types';

export function useAnalysis(trendId: string | null) {
  return useQuery({
    queryKey: ['analysis', trendId],
    queryFn: async () => {
      if (!trendId) return null;
      const { data, error } = await supabase
        .from('trend_analysis')
        .select('*')
        .eq('trend_id', trendId)
        .eq('analysis_type', 'deep_analysis')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return (data as TrendAnalysis) || null;
    },
    enabled: !!trendId,
  });
}

export function useCrossTrendSynthesis() {
  return useQuery({
    queryKey: ['cross-trend-synthesis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_analysis')
        .select('*')
        .eq('analysis_type', 'cross_trend_synthesis')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return (data as TrendAnalysis) || null;
    },
  });
}
