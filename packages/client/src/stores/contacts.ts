import type { PolicyOverrides } from '@confer/shared';
import { create } from 'zustand';
import i18n from '../i18n/index.js';
import { api } from '../lib/api.js';
import { captureError } from '../lib/error.js';
import { appendNew } from '../lib/list.js';

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

// One request's worth of contacts. The gateway caps `limit` at 100; this is the
// size of a "load more" step, not a hard ceiling on how many can be shown.
const PAGE_SIZE = 50;

interface ContactList {
  contacts: Contact[];
  total: number;
}

interface ContactsState {
  contacts: Contact[];
  contactsTotal: number;
  selectedContactId: string | null;
  selectedContact: Contact | null;
  dialogOpen: boolean;
  loading: boolean;
  loadingMore: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;

  loadContacts: () => Promise<void>;
  loadMoreContacts: () => Promise<void>;
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
  contactsTotal: 0,
  selectedContactId: null,
  selectedContact: null,
  dialogOpen: false,
  loading: false,
  loadingMore: false,
  saving: false,
  error: null,
  success: null,

  loadContacts: async () => {
    const data = await api.get<ContactList>(`/contacts?limit=${PAGE_SIZE}&offset=0`);
    set({ contacts: data.contacts, contactsTotal: data.total });
  },

  loadMoreContacts: async () => {
    const { contacts, contactsTotal, loadingMore } = get();
    if (loadingMore || contacts.length >= contactsTotal) return;
    set({ loadingMore: true });
    try {
      const data = await api.get<ContactList>(
        `/contacts?limit=${PAGE_SIZE}&offset=${contacts.length}`,
      );
      set((s) => ({
        contacts: appendNew(s.contacts, data.contacts),
        contactsTotal: data.total,
        loadingMore: false,
      }));
    } catch (e) {
      set({ loadingMore: false, error: captureError(e, 'Failed to load contacts') });
    }
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
      contactsTotal: Math.max(0, s.contactsTotal - 1),
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
