import { create } from 'zustand';
import { api } from '../lib/api.js';
import { captureError } from '../lib/error.js';

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

// The three list views (users/agents/conversations) share the same paginated
// load shape: toggle a loading flag, build `page`/`page_size` params, fetch, then
// map the response onto the store. This factory captures that flow; each view
// supplies its endpoint, the current page, the response→state mapping, and its
// loading-flag/error-fallback names. Keeping it internal preserves the public
// hook API (callers still use loadUsers/loadAgents/loadConversations).
function makePaginatedLoader<R>(config: {
  endpoint: string;
  loadingKey: 'loadingUsers' | 'loadingAgents' | 'loadingConversations';
  errorFallback: string;
  currentPage: () => number;
  extraParams?: (opts: { page?: number; query?: string } | undefined) => Record<string, string>;
  onSuccess: (data: R, opts: { page?: number; query?: string } | undefined) => Partial<AdminState>;
}) {
  return async (
    set: (partial: Partial<AdminState>) => void,
    pageSize: number,
    opts?: { page?: number; query?: string },
  ): Promise<void> => {
    const page = opts?.page ?? config.currentPage();
    set({ [config.loadingKey]: true, error: null } as Partial<AdminState>);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
      for (const [k, v] of Object.entries(config.extraParams?.(opts) ?? {})) params.set(k, v);
      const data = await api.get<R>(`${config.endpoint}?${params.toString()}`);
      set({ ...config.onSuccess(data, opts), [config.loadingKey]: false } as Partial<AdminState>);
    } catch (e) {
      set({
        [config.loadingKey]: false,
        error: captureError(e, config.errorFallback),
      } as Partial<AdminState>);
    }
  };
}

export const useAdminStore = create<AdminState>((set, get) => {
  const usersLoader = makePaginatedLoader<AdminUserList>({
    endpoint: '/admin/users',
    loadingKey: 'loadingUsers',
    errorFallback: 'Failed to load users',
    currentPage: () => get().page,
    extraParams: (opts): Record<string, string> => {
      const query = opts?.query ?? get().query;
      return query ? { q: query } : {};
    },
    onSuccess: (data, opts) => ({
      users: data.users,
      total: data.total,
      page: data.page,
      query: opts?.query ?? get().query,
    }),
  });
  const agentsLoader = makePaginatedLoader<AdminAgentList>({
    endpoint: '/admin/agents',
    loadingKey: 'loadingAgents',
    errorFallback: 'Failed to load agents',
    currentPage: () => get().agentsPage,
    onSuccess: (data) => ({
      agents: data.agents,
      agentsTotal: data.total,
      agentsPage: data.page,
    }),
  });
  const conversationsLoader = makePaginatedLoader<AdminConversationList>({
    endpoint: '/admin/conversations',
    loadingKey: 'loadingConversations',
    errorFallback: 'Failed to load conversations',
    currentPage: () => get().conversationsPage,
    onSuccess: (data) => ({
      conversations: data.conversations,
      conversationsTotal: data.total,
      conversationsPage: data.page,
    }),
  });

  return {
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

    loadUsers: (opts) => usersLoader(set, get().pageSize, opts),

    loadStats: async () => {
      set({ loadingStats: true, error: null });
      try {
        const data = await api.get<AdminStats>('/admin/stats');
        set({ stats: data, loadingStats: false });
      } catch (e) {
        set({ loadingStats: false, error: captureError(e, 'Failed to load stats') });
      }
    },

    updateUser: async (id, patch) => {
      await api.patch(`/admin/users/${id}`, patch);
      await get().loadUsers();
    },

    loadAgents: (opts) => agentsLoader(set, get().pageSize, opts),

    updateAgent: async (id, status) => {
      await api.patch(`/admin/agents/${id}`, { status });
      await get().loadAgents();
    },

    loadConversations: (opts) => conversationsLoader(set, get().pageSize, opts),

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
        set({ loadingConfig: false, error: captureError(e, 'Failed to load config') });
      }
    },

    updateConfig: async (patch) => {
      const data = await api.patch<{ config: AppConfigValues }>('/admin/config', patch);
      set({ config: data.config });
    },
  };
});
