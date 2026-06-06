import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the full api namespace so store logic is tested without a backend.
// (Partial stubs leak across files — keep every method, per the project gotcha.)
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const patch = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const put = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
const postForm = mock(async (_path: string, _form: FormData) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, patch, put, delete: del, postForm },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { useAdminStore } = await import('./admin.js');

const initial = useAdminStore.getState();

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  put.mockReset();
  del.mockReset();
  postForm.mockReset();
  useAdminStore.setState(initial, true);
});

afterEach(() => {
  useAdminStore.setState(initial, true);
});

describe('admin store — paginated loaders', () => {
  test('loadUsers stores the list, pagination + query, and clears loading', async () => {
    const users = [{ id: 'u1', username: 'alice', role: 'member', status: 'active' }];
    get.mockResolvedValueOnce({ users, page: 2, page_size: 20, total: 41 });

    await useAdminStore.getState().loadUsers({ page: 2, query: 'ali' });

    const [path] = get.mock.calls[0] as [string];
    expect(path).toContain('/admin/users?');
    expect(path).toContain('page=2');
    expect(path).toContain('q=ali');
    const state = useAdminStore.getState();
    expect(state.users).toEqual(users as never);
    expect(state.total).toBe(41);
    expect(state.page).toBe(2);
    expect(state.query).toBe('ali');
    expect(state.loadingUsers).toBe(false);
  });

  test('loadUsers omits the q param when there is no query', async () => {
    get.mockResolvedValueOnce({ users: [], page: 1, page_size: 20, total: 0 });
    await useAdminStore.getState().loadUsers({ page: 1 });
    const [path] = get.mock.calls[0] as [string];
    expect(path).not.toContain('q=');
  });

  test('loadUsers surfaces the error message and clears loading on failure', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    await useAdminStore.getState().loadUsers({ page: 1 });
    const state = useAdminStore.getState();
    expect(state.loadingUsers).toBe(false);
    expect(state.error).toBe('boom');
  });

  test('loadUsers falls back to a default error for non-Error throws', async () => {
    get.mockRejectedValueOnce('nope');
    await useAdminStore.getState().loadUsers({ page: 1 });
    expect(useAdminStore.getState().error).toBe('Failed to load users');
  });

  test('loadAgents stores agents + pagination and clears loading', async () => {
    const agents = [
      { id: 'a1', user_id: 'u1', did: 'did:web:x', is_public: true, status: 'active' },
    ];
    get.mockResolvedValueOnce({ agents, page: 1, page_size: 20, total: 3 });

    await useAdminStore.getState().loadAgents({ page: 1 });

    const [path] = get.mock.calls[0] as [string];
    expect(path).toContain('/admin/agents?');
    const state = useAdminStore.getState();
    expect(state.agents).toEqual(agents as never);
    expect(state.agentsTotal).toBe(3);
    expect(state.agentsPage).toBe(1);
    expect(state.loadingAgents).toBe(false);
  });

  test('loadAgents surfaces the error and clears loading', async () => {
    get.mockRejectedValueOnce(new Error('agent fail'));
    await useAdminStore.getState().loadAgents({ page: 1 });
    const state = useAdminStore.getState();
    expect(state.loadingAgents).toBe(false);
    expect(state.error).toBe('agent fail');
  });

  test('loadConversations stores conversations + pagination and clears loading', async () => {
    const conversations = [
      { id: 'c1', type: 'direct', created_by: 'u1', moderation_status: 'visible' },
    ];
    get.mockResolvedValueOnce({ conversations, page: 4, page_size: 20, total: 99 });

    await useAdminStore.getState().loadConversations({ page: 4 });

    const [path] = get.mock.calls[0] as [string];
    expect(path).toContain('/admin/conversations?');
    const state = useAdminStore.getState();
    expect(state.conversations).toEqual(conversations as never);
    expect(state.conversationsTotal).toBe(99);
    expect(state.conversationsPage).toBe(4);
    expect(state.loadingConversations).toBe(false);
  });

  test('loadConversations surfaces the error and clears loading', async () => {
    get.mockRejectedValueOnce(new Error('conv fail'));
    await useAdminStore.getState().loadConversations({ page: 1 });
    const state = useAdminStore.getState();
    expect(state.loadingConversations).toBe(false);
    expect(state.error).toBe('conv fail');
  });
});

describe('admin store — other actions', () => {
  test('loadStats stores stats and clears loading', async () => {
    const stats = { users: 1, conversations: 2, contacts: 3, messages: 4 };
    get.mockResolvedValueOnce(stats);
    await useAdminStore.getState().loadStats();
    const state = useAdminStore.getState();
    expect(get).toHaveBeenCalledWith('/admin/stats');
    expect(state.stats).toEqual(stats);
    expect(state.loadingStats).toBe(false);
  });

  test('loadStats surfaces the error and clears loading', async () => {
    get.mockRejectedValueOnce(new Error('stats fail'));
    await useAdminStore.getState().loadStats();
    expect(useAdminStore.getState().loadingStats).toBe(false);
    expect(useAdminStore.getState().error).toBe('stats fail');
  });

  test('updateUser patches then reloads users', async () => {
    patch.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({ users: [], page: 1, page_size: 20, total: 0 });
    await useAdminStore.getState().updateUser('u1', { role: 'admin' });
    expect(patch).toHaveBeenCalledWith('/admin/users/u1', { role: 'admin' });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/admin/users?'));
  });

  test('updateAgent patches status then reloads agents', async () => {
    patch.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({ agents: [], page: 1, page_size: 20, total: 0 });
    await useAdminStore.getState().updateAgent('a1', 'suspended');
    expect(patch).toHaveBeenCalledWith('/admin/agents/a1', { status: 'suspended' });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/admin/agents?'));
  });

  test('updateConversation patches moderation status then reloads conversations', async () => {
    patch.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({ conversations: [], page: 1, page_size: 20, total: 0 });
    await useAdminStore.getState().updateConversation('c1', 'hidden');
    expect(patch).toHaveBeenCalledWith('/admin/conversations/c1', { moderation_status: 'hidden' });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/admin/conversations?'));
  });

  test('loadConfig stores config and clears loading', async () => {
    const config = { registration_open: true, instance_name: 'Confer' };
    get.mockResolvedValueOnce({ config });
    await useAdminStore.getState().loadConfig();
    expect(get).toHaveBeenCalledWith('/admin/config');
    expect(useAdminStore.getState().config).toEqual(config);
    expect(useAdminStore.getState().loadingConfig).toBe(false);
  });

  test('updateConfig patches and replaces config from the response', async () => {
    const config = { registration_open: false, instance_name: 'Renamed' };
    patch.mockResolvedValueOnce({ config });
    await useAdminStore.getState().updateConfig({ instance_name: 'Renamed' });
    expect(patch).toHaveBeenCalledWith('/admin/config', { instance_name: 'Renamed' });
    expect(useAdminStore.getState().config).toEqual(config);
  });
});
