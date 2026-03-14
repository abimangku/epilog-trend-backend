import { create } from 'zustand';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface ToastState {
  message: string | null;
  type: 'success' | 'error' | 'info';
  show: (message: string, type?: 'success' | 'error' | 'info') => void;
  dismiss: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  type: 'info',
  show: (message, type = 'info') => set({ message, type }),
  dismiss: () => set({ message: null }),
}));

export function ToastContainer() {
  const { message, type, dismiss } = useToast();

  useEffect(() => {
    if (message) {
      const timer = setTimeout(dismiss, 3000);
      return () => clearTimeout(timer);
    }
  }, [message, dismiss]);

  const colors = {
    success: 'var(--brand-stella)',
    error: 'var(--brand-hitkecoa)',
    info: 'var(--text-secondary)',
  };

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg text-[13px]"
          style={{
            background: 'var(--bg-card)',
            border: `1px solid var(--border-card)`,
            color: colors[type],
          }}
        >
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
