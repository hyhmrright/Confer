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

export interface AdminAgent {
  id: string;
  user_id: string;
  name?: string | null;
  did: string;
  is_public: boolean;
  status: string;
  created_at: string;
}

export interface AdminConversation {
  id: string;
  type: string;
  name?: string | null;
  created_by: string;
  moderation_status: string;
  created_at: string;
  updated_at: string;
}

export interface AppConfigValues {
  registration_open: boolean;
  instance_name: string;
}

interface AdminAgentList {
  agents: AdminAgent[];
  page: number;
  page_size: number;
  total: number;
}

interface AdminConversationList {
  conversations: AdminConversation[];
  page: number;
  page_size: number;
  total: number;
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

  agents: AdminAgent[];
  agentsTotal: number;
  agentsPage: number;
  loadingAgents: boolean;
  conversations: AdminConversation[];
  conversationsTotal: number;
  conversationsPage: number;
  loadingConversations: boolean;
  config: AppConfigValues | null;
  loadingConfig: boolean;

  loadUsers: (opts?: { page?: number; query?: string }) => Promise<void>;
  loadStats: () => Promise<void>;
  updateUser: (id: string, patch: { role?: string; status?: string }) => Promise<void>;
  loadAgents: (opts?: { page?: number }) => Promise<void>;
  updateAgent: (id: string, status: string) => Promise<void>;
  loadConversations: (opts?: { page?: number }) => Promise<void>;
  updateConversation: (id: string, moderationStatus: string) => Promise<void>;
  loadConfig: () => Promise<void>;
  updateConfig: (patch: Partial<AppConfigValues>) => Promise<void>;
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
  agents: [],
  agentsTotal: 0,
  agentsPage: 1,
  loadingAgents: false,
  conversations: [],
  conversationsTotal: 0,
  conversationsPage: 1,
  loadingConversations: false,
  config: null,
  loadingConfig: false,

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

  loadAgents: async (opts) => {
    const page = opts?.page ?? get().agentsPage;
    set({ loadingAgents: true, error: null });
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(get().pageSize) });
      const data = await api.get<AdminAgentList>(`/admin/agents?${params.toString()}`);
      set({
        agents: data.agents,
        agentsTotal: data.total,
        agentsPage: data.page,
        loadingAgents: false,
      });
    } catch (e) {
      set({
        loadingAgents: false,
        error: e instanceof Error ? e.message : 'Failed to load agents',
      });
    }
  },

  updateAgent: async (id, status) => {
    await api.patch(`/admin/agents/${id}`, { status });
    await get().loadAgents();
  },

  loadConversations: async (opts) => {
    const page = opts?.page ?? get().conversationsPage;
    set({ loadingConversations: true, error: null });
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(get().pageSize) });
      const data = await api.get<AdminConversationList>(
        `/admin/conversations?${params.toString()}`,
      );
      set({
        conversations: data.conversations,
        conversationsTotal: data.total,
        conversationsPage: data.page,
        loadingConversations: false,
      });
    } catch (e) {
      set({
        loadingConversations: false,
        error: e instanceof Error ? e.message : 'Failed to load conversations',
      });
    }
  },

  updateConversation: async (id, moderationStatus) => {
    await api.patch(`/admin/conversations/${id}`, { moderation_status: moderationStatus });
    await get().loadConversations();
  },

  loadConfig: async () => {
    set({ loadingConfig: true, error: null });
    try {
      const data = await api.get<{ config: AppConfigValues }>('/admin/config');
      set({ config: data.config, loadingConfig: false });
    } catch (e) {
      set({
        loadingConfig: false,
        error: e instanceof Error ? e.message : 'Failed to load config',
      });
    }
  },

  updateConfig: async (patch) => {
    const data = await api.patch<{ config: AppConfigValues }>('/admin/config', patch);
    set({ config: data.config });
  },
}));
