import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { FormatDistribution, AudioMomentum } from '../types';

export function useFormatPatterns(days?: number) {
  return useQuery({
    queryKey: ['patterns-formats', days],
    queryFn: () => apiFetch<FormatDistribution[]>(`/patterns/formats${days ? `?days=${days}` : ''}`),
  });
}

export function useAudioPatterns(days?: number) {
  return useQuery({
    queryKey: ['patterns-audio', days],
    queryFn: () => apiFetch<AudioMomentum[]>(`/patterns/audio${days ? `?days=${days}` : ''}`),
  });
}
