import { create } from 'zustand';
import { api } from '../lib/api.js';

export interface Memory {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  source: 'auto' | 'manual';
  created_at: string;
  updated_at: string;
}

interface MemoriesState {
  memories: Memory[];
  loading: boolean;
  loadMemories: () => Promise<void>;
  createMemory: (title: string, content: string, tags?: string[]) => Promise<void>;
  updateMemory: (
    id: string,
    patch: Partial<Pick<Memory, 'title' | 'content' | 'tags' | 'pinned'>>,
  ) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
}

// The API returns `tags: null` for memories stored without tags (e.g.
// auto-extracted ones — the column has no default). The UI assumes an array,
// so coalesce at this boundary to keep the `Memory.tags: string[]` contract.
function normalizeMemory(m: Memory): Memory {
  return { ...m, tags: m.tags ?? [] };
}

export const useMemoriesStore = create<MemoriesState>((set) => ({
  memories: [],
  loading: false,

  loadMemories: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ memories: Memory[] }>('/memories');
      set({ memories: data.memories.map(normalizeMemory) });
    } finally {
      set({ loading: false });
    }
  },

  createMemory: async (title, content, tags = []) => {
    const data = await api.post<{ memory: Memory }>('/memories', { title, content, tags });
    set((s) => ({ memories: [normalizeMemory(data.memory), ...s.memories] }));
  },

  updateMemory: async (id, patch) => {
    const data = await api.patch<{ memory: Memory }>(`/memories/${id}`, patch);
    set((s) => ({
      memories: s.memories.map((m) => (m.id === id ? normalizeMemory(data.memory) : m)),
    }));
  },

  deleteMemory: async (id) => {
    await api.delete(`/memories/${id}`);
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }));
  },
}));
