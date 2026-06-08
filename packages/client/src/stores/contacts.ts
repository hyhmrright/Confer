import { create } from 'zustand';
import { api } from '../lib/api.js';
import { captureError } from '../lib/error.js';

interface PeerAgent {
  id: string;
  did: string;
  name?: string;
  description?: string;
  organization?: string;
  trust_level: string;
}

interface Contact {
  id: string;
  user_id: string;
  peer_id: string;
  alias?: string;
  peer: PeerAgent;
}

interface ContactsState {
  contacts: Contact[];
  dialogOpen: boolean;
  loading: boolean;
  error: string | null;

  loadContacts: () => Promise<void>;
  addContact: (peerId: string, alias?: string) => Promise<void>;
  removeContact: (contactId: string) => Promise<void>;
  lookupByDomain: (domain: string) => Promise<PeerAgent[]>;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  dialogOpen: false,
  loading: false,
  error: null,

  loadContacts: async () => {
    const data = await api.get<{ contacts: Contact[] }>('/contacts');
    set({ contacts: data.contacts });
  },

  addContact: async (peerId, alias) => {
    set({ loading: true, error: null });
    try {
      await api.post('/contacts', { peer_id: peerId, alias });
      await get().loadContacts();
      set({ loading: false, dialogOpen: false });
    } catch (e) {
      set({ loading: false, error: captureError(e, 'Failed to add contact') });
    }
  },

  removeContact: async (contactId) => {
    await api.delete(`/contacts/${contactId}`);
    set((s) => ({ contacts: s.contacts.filter((c) => c.id !== contactId) }));
  },

  lookupByDomain: async (domain) => {
    set({ error: null });
    const data = await api.post<{ candidates: PeerAgent[]; error?: string }>('/contacts/lookup', {
      method: 'domain',
      value: domain,
    });
    // Surface the backend's reason (e.g. "Private addresses not allowed",
    // resolution timeout) instead of silently collapsing to "未找到 Agent".
    if (data.error && data.candidates.length === 0) {
      set({ error: data.error });
    }
    return data.candidates;
  },

  openDialog: () => set({ dialogOpen: true, error: null }),
  closeDialog: () => set({ dialogOpen: false, error: null }),
}));
