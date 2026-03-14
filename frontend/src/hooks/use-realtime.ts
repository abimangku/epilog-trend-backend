import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useRealtimeTrends() {
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel('trends-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trends' }, () => {
        queryClient.invalidateQueries({ queryKey: ['trends'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trend_analysis' }, () => {
        queryClient.invalidateQueries({ queryKey: ['analysis'] });
        queryClient.invalidateQueries({ queryKey: ['cross-trend-synthesis'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'client_brand_fit' }, () => {
        queryClient.invalidateQueries({ queryKey: ['brand-fits'] });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [queryClient]);
}
