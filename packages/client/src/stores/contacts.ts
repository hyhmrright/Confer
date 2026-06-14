import type { PolicyOverrides } from '@confer/shared';
import { create } from 'zustand';
import i18n from '../i18n/index.js';
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
  alias?: string | null;
  tags?: string[];
  pinned?: boolean;
  muted?: boolean;
  // Per-contact standing policy override. Engine vocabulary
  // (`{ default?, rules? }` with `allow`/`ask_user`/`deny`), stored under this
  // exact DB column key on every contact row the gateway returns.
  policy_overrides_json?: PolicyOverrides;
  peer: PeerAgent;
}

// Write responses from PATCH /contacts/:id and POST /contacts/:id/policies omit
// the `peer` join, so the row they return is peer-less.
type PeerlessContact = Omit<Contact, 'peer'>;

interface ContactsState {
  contacts: Contact[];
  selectedContactId: string | null;
  selectedContact: Contact | null;
  dialogOpen: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;

  loadContacts: () => Promise<void>;
  addContact: (peerId: string, alias?: string) => Promise<void>;
  removeContact: (contactId: string) => Promise<void>;
  lookupByDomain: (domain: string) => Promise<PeerAgent[]>;
  openDialog: () => void;
  closeDialog: () => void;
  openDetail: (contactId: string) => Promise<void>;
  closeDetail: () => void;
  setContactPolicy: (contactId: string, overrides: PolicyOverrides) => Promise<void>;
  clearDetailMessages: () => void;
}

// Merge a peer-less write response into the matching cached contact while
// preserving the cached `peer` join, both in the list and in `selectedContact`.
// Without this, replacing the cached row with the write response would drop the
// peer name/did/org from the UI.
function mergePeerlessUpdate(
  state: Pick<ContactsState, 'contacts' | 'selectedContact'>,
  updated: PeerlessContact,
): Pick<ContactsState, 'contacts' | 'selectedContact'> {
  return {
    contacts: state.contacts.map((c) =>
      c.id === updated.id ? { ...c, ...updated, peer: c.peer } : c,
    ),
    selectedContact:
      state.selectedContact?.id === updated.id
        ? { ...state.selectedContact, ...updated, peer: state.selectedContact.peer }
        : state.selectedContact,
  };
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  selectedContactId: null,
  selectedContact: null,
  dialogOpen: false,
  loading: false,
  saving: false,
  error: null,
  success: null,

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
    set((s) => ({
      contacts: s.contacts.filter((c) => c.id !== contactId),
      selectedContactId: s.selectedContactId === contactId ? null : s.selectedContactId,
      selectedContact: s.selectedContact?.id === contactId ? null : s.selectedContact,
    }));
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

  // Open the detail panel for a contact and load the full row (incl. `peer`)
  // from GET /contacts/:id so the panel always has the latest policy + identity.
  openDetail: async (contactId) => {
    set({ selectedContactId: contactId, loading: true, error: null, success: null });
    try {
      const data = await api.get<{ contact: Contact }>(`/contacts/${contactId}`);
      // Discard a stale response if the user already switched to another contact.
      if (get().selectedContactId !== contactId) return;
      set({ selectedContact: data.contact, loading: false });
    } catch (e) {
      if (get().selectedContactId !== contactId) return;
      set({ loading: false, error: captureError(e, i18n.t('settings.loadFailed')) });
    }
  },

  closeDetail: () =>
    set({ selectedContactId: null, selectedContact: null, error: null, success: null }),

  setContactPolicy: async (contactId, overrides) => {
    set({ saving: true, error: null, success: null });
    try {
      // Whole-object replace (PUT semantics): send the full { default?, rules? }
      // override. Callers preserve any existing `rules` they read.
      const data = await api.post<{ contact: PeerlessContact }>(
        `/contacts/${contactId}/policies`,
        overrides,
      );
      set((s) => ({
        ...mergePeerlessUpdate(s, data.contact),
        saving: false,
        success: i18n.t('contacts.policySaved'),
      }));
    } catch (e) {
      set({ saving: false, error: captureError(e, i18n.t('contacts.policySaveFailed')) });
    }
  },

  clearDetailMessages: () => set({ error: null, success: null }),
}));
