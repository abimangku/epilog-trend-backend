import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface ScheduleConfig {
  id: string;
  label: string;
  cron_expression: string;
  enabled: boolean;
  ai_analysis_enabled: boolean;
  interval_minutes: number;
  created_at: string;
}

export function useSchedules() {
  return useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_config')
        .select('*')
        .order('label');

      if (error) throw error;
      return (data || []) as ScheduleConfig[];
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: Partial<ScheduleConfig> }) => {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(update),
      });
      if (!res.ok) throw new Error('Failed to update schedule');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });
}

export type { ScheduleConfig };
