import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { SavedItem, Collection } from '../types';

export function useSavedItems() {
  return useQuery({
    queryKey: ['saved-items'],
    queryFn: () => apiFetch<SavedItem[]>('/saved'),
  });
}

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: () => apiFetch<Collection[]>('/collections'),
  });
}

export function useSaveTrend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trendId: string) =>
      apiFetch(`/saved/${trendId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
  });
}

export function useUnsaveTrend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trendId: string) =>
      apiFetch(`/saved/${trendId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Collection>('/collections', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/collections/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });
}

export function useAddToCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, trendId }: { collectionId: string; trendId: string }) =>
      apiFetch(`/collections/${collectionId}/items`, {
        method: 'POST',
        body: JSON.stringify({ trend_id: trendId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
  });
}

export function useRemoveFromCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ collectionId, trendId }: { collectionId: string; trendId: string }) =>
      apiFetch(`/collections/${collectionId}/items/${trendId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['saved-items'] });
    },
  });
}
