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

// A decided permission row from `GET /permissions/history`. These are RAW
// `permissions` rows (no join) — unlike `/pending` there is NO `peer_name` and
// NO `description`. `peer_id` and `decided_at` may be null. Only the fields the
// history view renders are typed here.
interface PermissionHistoryEntry {
  id: string;
  action: string;
  level: string;
  decision: string | null;
  peer_id: string | null;
  decided_at: string | null;
}

interface PermissionsState {
  pending: PermissionRequest[];
  history: PermissionHistoryEntry[];
  loadPending: () => Promise<void>;
  loadHistory: () => Promise<void>;
  addRequest: (req: PermissionRequest) => void;
  removeRequest: (id: string) => void;
}

export const usePermissionsStore = create<PermissionsState>((set) => ({
  pending: [],
  history: [],

  loadPending: async () => {
    try {
      const data = await api.get<{ permissions: PermissionRequest[] }>('/permissions/pending');
      set({ pending: data.permissions });
    } catch {
      // endpoint might not exist yet
    }
  },

  loadHistory: async () => {
    try {
      const data = await api.get<{ permissions: PermissionHistoryEntry[] }>('/permissions/history');
      set({ history: data.permissions });
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
