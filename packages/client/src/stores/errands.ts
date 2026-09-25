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

export type CardDecision = 'approve' | 'change_price' | 'reject';

interface ErrandsState {
  pendingCards: ErrandCard[];
  creating: boolean;
  error: string | null;

  loadPendingCards: () => Promise<void>;
  createErrand: (title: string, kind?: string) => Promise<void>;
  decideCard: (cardId: string, decision: CardDecision, newPriceCents?: number) => Promise<void>;
  removeCard: (cardId: string) => void;
}

export const useErrandsStore = create<ErrandsState>((set, get) => ({
  pendingCards: [],
  creating: false,
  error: null,

  loadPendingCards: async () => {
    try {
      const data = await api.get<{ cards: ErrandCard[] }>('/errands/cards/pending');
      // This runs on a 15s timer forever. Assigning unconditionally would hand
      // every subscriber a new array identity four times a minute — and the
      // usual response is the identical (usually empty) set. Returning the
      // existing state is a no-op in zustand, so an unchanged poll costs nothing.
      set((s) => {
        const unchanged =
          s.pendingCards.length === data.cards.length &&
          s.pendingCards.every((card, i) => card.id === data.cards[i]?.id);
        return unchanged ? s : { pendingCards: data.cards };
      });
    } catch {
      // endpoint might not exist yet
    }
  },

  createErrand: async (title, kind) => {
    set({ creating: true, error: null });
    try {
      await api.post('/errands', { title, kind });
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
