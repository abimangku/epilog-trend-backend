import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface PipelineEvent {
  id: string;
  run_id: string | null;
  stage: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
  acknowledged: boolean;
  created_at: string;
}

export function usePipelineEvents(runId?: string | null, limit = 50) {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const query = useQuery({
    queryKey: ['pipeline-events', runId, limit],
    queryFn: async () => {
      let q = supabase
        .from('pipeline_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (runId) {
        q = q.eq('run_id', runId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PipelineEvent[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('pipeline-events-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_events' }, () => {
        queryClient.invalidateQueries({ queryKey: ['pipeline-events'] });
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

export function useUnacknowledgedCriticalCount() {
  return useQuery({
    queryKey: ['pipeline-events', 'unacknowledged-critical'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('pipeline_events')
        .select('*', { count: 'exact', head: true })
        .eq('severity', 'critical')
        .eq('acknowledged', false);

      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 60000,
  });
}

export type { PipelineEvent };
