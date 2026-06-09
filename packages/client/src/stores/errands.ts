import { create } from 'zustand';
import { api } from '../lib/api.js';
import { captureError } from '../lib/error.js';

export interface ErrandCard {
  id: string;
  errand_id: string;
  errand_title: string;
  kind: string;
  summary: string;
  currency: string;
  base_price_cents: number | null;
  price_delta_cents: number | null;
  strictly_necessary: boolean;
  expires_at: string;
  created_at: string;
}

export interface Errand {
  id: string;
  owner_user_id: string;
  title: string;
  kind: string | null;
  status: string;
  created_at: string;
}

export type CardDecision = 'approve' | 'change_price' | 'reject';

interface ErrandsState {
  errands: Errand[];
  pendingCards: ErrandCard[];
  creating: boolean;
  error: string | null;

  loadErrands: () => Promise<void>;
  loadPendingCards: () => Promise<void>;
  createErrand: (title: string, kind?: string) => Promise<void>;
  decideCard: (cardId: string, decision: CardDecision, newPriceCents?: number) => Promise<void>;
  removeCard: (cardId: string) => void;
}

export const useErrandsStore = create<ErrandsState>((set, get) => ({
  errands: [],
  pendingCards: [],
  creating: false,
  error: null,

  loadErrands: async () => {
    try {
      const data = await api.get<{ errands: Errand[] }>('/errands');
      set({ errands: data.errands });
    } catch {
      // endpoint might not exist yet
    }
  },

  loadPendingCards: async () => {
    try {
      const data = await api.get<{ cards: ErrandCard[] }>('/errands/cards/pending');
      set({ pendingCards: data.cards });
    } catch {
      // endpoint might not exist yet
    }
  },

  createErrand: async (title, kind) => {
    set({ creating: true, error: null });
    try {
      await api.post('/errands', { title, kind });
      await get().loadErrands();
      set({ creating: false });
    } catch (e) {
      set({ creating: false, error: captureError(e, 'Failed to create errand') });
    }
  },

  decideCard: async (cardId, decision, newPriceCents) => {
    await api.post(`/errands/cards/${cardId}/decide`, {
      decision,
      new_price_cents: decision === 'change_price' ? newPriceCents : undefined,
    });
    get().removeCard(cardId);
  },

  removeCard: (cardId) => {
    set((s) => ({ pendingCards: s.pendingCards.filter((c) => c.id !== cardId) }));
  },
}));
