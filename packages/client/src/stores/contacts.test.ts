import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({ contacts: [] }) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, delete: del },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { useContactsStore } = await import('./contacts.js');

const initial = useContactsStore.getState();

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  useContactsStore.setState({
    contacts: [],
    selectedContactId: null,
    selectedContact: null,
    dialogOpen: false,
    loading: false,
    saving: false,
    error: null,
    success: null,
  });
});

afterEach(() => {
  useContactsStore.setState(initial, true);
});

describe('contacts store', () => {
  test('loadContacts stores the fetched list', async () => {
    const contacts = [{ id: 'c1', user_id: 'u1', peer_id: 'p1', peer: { id: 'p1' } }];
    get.mockResolvedValueOnce({ contacts });
    await useContactsStore.getState().loadContacts();
    expect(get).toHaveBeenCalledWith('/contacts');
    expect(useContactsStore.getState().contacts).toEqual(contacts as never);
  });

  test('addContact posts, reloads, and closes the dialog on success', async () => {
    useContactsStore.setState({ dialogOpen: true });
    get.mockResolvedValueOnce({ contacts: [] });
    await useContactsStore.getState().addContact('p1', 'Bob');
    expect(post).toHaveBeenCalledWith('/contacts', { peer_id: 'p1', alias: 'Bob' });
    const state = useContactsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.dialogOpen).toBe(false);
    expect(state.error).toBeNull();
  });

  test('addContact surfaces the error and keeps the dialog open on failure', async () => {
    useContactsStore.setState({ dialogOpen: true });
    post.mockRejectedValueOnce(new Error('peer not found'));
    await useContactsStore.getState().addContact('p1');
    const state = useContactsStore.getState();
    expect(state.loading).toBe(false);
    expect(state.dialogOpen).toBe(true);
    expect(state.error).toBe('peer not found');
  });

  test('removeContact deletes and drops the contact from state', async () => {
    useContactsStore.setState({
      contacts: [
        { id: 'c1', user_id: 'u1', peer_id: 'p1', peer: { id: 'p1' } },
        { id: 'c2', user_id: 'u1', peer_id: 'p2', peer: { id: 'p2' } },
      ] as never,
    });
    await useContactsStore.getState().removeContact('c1');
    expect(del).toHaveBeenCalledWith('/contacts/c1');
    expect(useContactsStore.getState().contacts.map((c) => c.id)).toEqual(['c2']);
  });

  test('setContactPolicy posts the whole engine-shape override', async () => {
    post.mockResolvedValueOnce({
      contact: { id: 'c1', policy_overrides_json: { default: 'deny' } },
    });
    const overrides = {
      default: 'deny' as const,
      rules: [{ action: 'send_message', decision: 'allow' as const }],
    };
    await useContactsStore.getState().setContactPolicy('c1', overrides);
    expect(post).toHaveBeenCalledWith('/contacts/c1/policies', {
      default: 'deny',
      rules: [{ action: 'send_message', decision: 'allow' }],
    });
  });

  test('setContactPolicy preserves the cached peer on the peer-less write response', async () => {
    const peer = {
      id: 'p1',
      did: 'did:web:vendor.example.com',
      name: 'Vendor',
      trust_level: 'unknown',
    };
    useContactsStore.setState({
      contacts: [{ id: 'c1', user_id: 'u1', peer_id: 'p1', peer }] as never,
      selectedContact: { id: 'c1', user_id: 'u1', peer_id: 'p1', peer } as never,
      selectedContactId: 'c1',
    });
    // Write response omits `peer` (matches POST /contacts/:id/policies).
    post.mockResolvedValueOnce({
      contact: {
        id: 'c1',
        user_id: 'u1',
        peer_id: 'p1',
        policy_overrides_json: { default: 'ask_user' },
      },
    });
    await useContactsStore.getState().setContactPolicy('c1', { default: 'ask_user' });
    const state = useContactsStore.getState();
    expect(state.contacts[0]?.peer).toEqual(peer as never);
    expect(state.contacts[0]?.policy_overrides_json).toEqual({ default: 'ask_user' } as never);
    expect(state.selectedContact?.peer).toEqual(peer as never);
  });

  test('lookupByDomain sends method+value and returns candidates', async () => {
    const candidates = [{ id: 'p1', did: 'did:web:vendor.example.com', trust_level: 'unknown' }];
    post.mockResolvedValueOnce({ candidates });
    const result = await useContactsStore.getState().lookupByDomain('vendor.example.com');
    expect(post).toHaveBeenCalledWith('/contacts/lookup', {
      method: 'domain',
      value: 'vendor.example.com',
    });
    expect(result).toEqual(candidates as never);
  });
});
