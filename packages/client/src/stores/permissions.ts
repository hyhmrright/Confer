import { create } from 'zustand';
import { api } from '../lib/api.js';

interface PermissionRequest {
  id: string;
  level: string;
  action: string;
  scope: Record<string, unknown>;
  description: string;
  requested_at: string;
  decision?: string;
}

interface PermissionsState {
  pending: PermissionRequest[];
  loadPending: () => Promise<void>;
  addRequest: (req: PermissionRequest) => void;
  removeRequest: (id: string) => void;
}

export const usePermissionsStore = create<PermissionsState>((set) => ({
  pending: [],

  loadPending: async () => {
    try {
      const data = await api.get<{ permissions: PermissionRequest[] }>('/permissions/pending');
      set({ pending: data.permissions });
    } catch {
      // endpoint might not exist yet
    }
  },

  addRequest: (req) => {
    set((s) => ({ pending: [req, ...s.pending] }));
  },

  removeRequest: (id) => {
    set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
  },
}));
