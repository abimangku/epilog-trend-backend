import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ClientBrandFit, ClientName } from '../types';

export function useBrandFits(trendId: string | null) {
  return useQuery({
    queryKey: ['brand-fits', trendId],
    queryFn: async () => {
      if (!trendId) return [];
      const { data, error } = await supabase
        .from('client_brand_fit')
        .select('*')
        .eq('trend_id', trendId);

      if (error) throw error;
      return data as ClientBrandFit[];
    },
    enabled: !!trendId,
  });
}

export function useBrandFitsByBrand(brandName: ClientName) {
  return useQuery({
    queryKey: ['brand-fits-by-brand', brandName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_brand_fit')
        .select('*')
        .eq('brand_name', brandName)
        .order('fit_score', { ascending: false });

      if (error) throw error;
      return data as ClientBrandFit[];
    },
  });
}
