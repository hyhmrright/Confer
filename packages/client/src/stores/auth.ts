import { create } from 'zustand';
import { api, setToken, setRefreshToken } from '../lib/api.js';

interface User {
  id: string;
  username: string;
  email?: string;
  phone?: string;
  display_name?: string;
  avatar_url?: string;
  did: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  loading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => void;
  refreshUser: () => Promise<void>;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  loading: false,
  error: null,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/login', {
        username,
        password,
        device_id: getDeviceId(),
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      localStorage.setItem('confer_auth', JSON.stringify(data));
      set({
        user: data.user,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Login failed' });
      throw e;
    }
  },

  register: async (username, password, displayName) => {
    set({ loading: true, error: null });
    try {
      const data = await api.post<AuthResponse>('/auth/register', {
        username,
        password,
        display_name: displayName,
      });
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      localStorage.setItem('confer_auth', JSON.stringify(data));
      set({
        user: data.user,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Registration failed' });
      throw e;
    }
  },

  logout: () => {
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem('confer_auth');
    set({ user: null, accessToken: null, refreshToken: null });
  },

  refreshUser: async () => {
    try {
      const data = await api.get<{ user: User }>('/users/me');
      set((s) => ({ user: data.user ?? s.user }));
    } catch {
      // ignore
    }
  },

  restoreSession: () => {
    const stored = localStorage.getItem('confer_auth');
    if (!stored) return;
    try {
      const data = JSON.parse(stored) as AuthResponse;
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      set({
        user: data.user,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });
    } catch {
      localStorage.removeItem('confer_auth');
    }
  },
}));

function getDeviceId(): string {
  let id = localStorage.getItem('confer_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('confer_device_id', id);
  }
  return id;
}
