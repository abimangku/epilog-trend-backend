import { create } from 'zustand';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  setAuthenticated: (value: boolean) => void;
  setLoading: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  authenticated: false,
  loading: true,
  setAuthenticated: (value) => set({ authenticated: value }),
  setLoading: (value) => set({ loading: value }),
}));
