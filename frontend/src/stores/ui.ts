import { create } from 'zustand';

interface UIState {
  sidebarCollapsed: boolean;
  viewMode: 'grid' | 'list';
  detailPanelTrendId: string | null;
  detailPanelTrendIds: string[];
  toggleSidebar: () => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  openDetailPanel: (trendId: string, trendIds: string[]) => void;
  closeDetailPanel: () => void;
  navigateDetail: (direction: 'prev' | 'next') => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  viewMode: 'grid',
  detailPanelTrendId: null,
  detailPanelTrendIds: [],
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setViewMode: (mode) => set({ viewMode: mode }),
  openDetailPanel: (trendId, trendIds) => set({ detailPanelTrendId: trendId, detailPanelTrendIds: trendIds }),
  closeDetailPanel: () => set({ detailPanelTrendId: null, detailPanelTrendIds: [] }),
  navigateDetail: (direction) => {
    const { detailPanelTrendId, detailPanelTrendIds } = get();
    if (!detailPanelTrendId || detailPanelTrendIds.length === 0) return;
    const idx = detailPanelTrendIds.indexOf(detailPanelTrendId);
    if (idx === -1) return;
    const nextIdx = direction === 'next'
      ? Math.min(idx + 1, detailPanelTrendIds.length - 1)
      : Math.max(idx - 1, 0);
    set({ detailPanelTrendId: detailPanelTrendIds[nextIdx] });
  },
}));
