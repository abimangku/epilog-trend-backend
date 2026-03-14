import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface PipelineRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  status: 'running' | 'success' | 'partial' | 'failed';
  videos_scraped: number;
  videos_passed_gate: number;
  videos_analyzed: number;
  videos_failed: number;
  errors: Array<{ stage: string; message?: string; error?: string }>;
  created_at: string;
}

export function usePipelineRuns(limit = 10) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['pipeline-runs', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data || []) as PipelineRun[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('pipeline-runs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_runs' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pipeline-runs'] });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [queryClient]);

  return query;
}

export function useLatestRun() {
  return useQuery({
    queryKey: ['pipeline-runs', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pipeline_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as PipelineRun | null;
    },
    refetchInterval: 30000,
  });
}

export type { PipelineRun };
