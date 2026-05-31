import { create } from 'zustand';
import { api } from '../lib/api.js';

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
      set({ loading: false, error: e instanceof Error ? e.message : 'Failed to add contact' });
    }
  },

  removeContact: async (contactId) => {
    await api.delete(`/contacts/${contactId}`);
    set((s) => ({ contacts: s.contacts.filter((c) => c.id !== contactId) }));
  },

  lookupByDomain: async (domain) => {
    const data = await api.post<{ candidates: PeerAgent[] }>('/contacts/lookup', {
      method: 'domain',
      value: domain,
    });
    return data.candidates;
  },

  openDialog: () => set({ dialogOpen: true, error: null }),
  closeDialog: () => set({ dialogOpen: false, error: null }),
}));
