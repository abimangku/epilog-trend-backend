import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { ForYouResponse } from '../types';

export function useForYou() {
  return useQuery({
    queryKey: ['for-you'],
    queryFn: () => apiFetch<ForYouResponse>('/for-you'),
  });
}
