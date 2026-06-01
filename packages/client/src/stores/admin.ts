import { create } from 'zustand';
import { api } from '../lib/api.js';

export interface AdminUser {
  id: string;
  username: string;
  display_name?: string | null;
  email?: string | null;
  role: string;
  status: string;
  created_at: string;
}

interface AdminUserList {
  users: AdminUser[];
  page: number;
  page_size: number;
  total: number;
}

export interface AdminStats {
  users: number;
  conversations: number;
  contacts: number;
  messages: number;
}

interface AdminState {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  stats: AdminStats | null;
  loadingUsers: boolean;
  loadingStats: boolean;
  error: string | null;

  loadUsers: (opts?: { page?: number; query?: string }) => Promise<void>;
  loadStats: () => Promise<void>;
  updateUser: (id: string, patch: { role?: string; status?: string }) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set, get) => ({
  users: [],
  total: 0,
  page: 1,
  pageSize: 20,
  query: '',
  stats: null,
  loadingUsers: false,
  loadingStats: false,
  error: null,

  loadUsers: async (opts) => {
    const page = opts?.page ?? get().page;
    const query = opts?.query ?? get().query;
    set({ loadingUsers: true, error: null });
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(get().pageSize) });
      if (query) params.set('q', query);
      const data = await api.get<AdminUserList>(`/admin/users?${params.toString()}`);
      set({
        users: data.users,
        total: data.total,
        page: data.page,
        query,
        loadingUsers: false,
      });
    } catch (e) {
      set({ loadingUsers: false, error: e instanceof Error ? e.message : 'Failed to load users' });
    }
  },

  loadStats: async () => {
    set({ loadingStats: true, error: null });
    try {
      const data = await api.get<AdminStats>('/admin/stats');
      set({ stats: data, loadingStats: false });
    } catch (e) {
      set({ loadingStats: false, error: e instanceof Error ? e.message : 'Failed to load stats' });
    }
  },

  updateUser: async (id, patch) => {
    await api.patch(`/admin/users/${id}`, patch);
    await get().loadUsers();
  },
}));
