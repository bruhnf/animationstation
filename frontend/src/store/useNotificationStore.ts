import { create } from 'zustand';
import api from '../config/api';

interface NotificationStore {
  unreadCount: number;
  fetchUnreadCount: () => Promise<void>;
  clearUnreadCount: () => void;
  decrementUnreadCount: () => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
  unreadCount: 0,

  fetchUnreadCount: async () => {
    try {
      const { data } = await api.get<{ unreadCount: number }>('/notifications/unread-count');
      set({ unreadCount: data.unreadCount });
    } catch {
      // Silently fail — badge simply won't show
    }
  },

  clearUnreadCount: () => set({ unreadCount: 0 }),

  decrementUnreadCount: () => set((state) => ({ unreadCount: Math.max(0, state.unreadCount - 1) })),
}));
