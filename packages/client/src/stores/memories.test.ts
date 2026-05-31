import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({ memories: [] }) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const patch = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, patch, delete: del },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { useMemoriesStore } = await import('./memories.js');

const initial = useMemoriesStore.getState();

const mem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  title: `title ${id}`,
  content: `content ${id}`,
  tags: [],
  pinned: false,
  source: 'manual',
  created_at: '2026-05-31T00:00:00Z',
  updated_at: '2026-05-31T00:00:00Z',
  ...over,
});

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  del.mockReset();
  useMemoriesStore.setState({ memories: [], loading: false });
});

afterEach(() => {
  useMemoriesStore.setState(initial, true);
});

describe('memories store', () => {
  test('loadMemories fetches the list and clears loading', async () => {
    const memories = [mem('m1'), mem('m2')];
    get.mockResolvedValueOnce({ memories });
    await useMemoriesStore.getState().loadMemories();
    expect(get).toHaveBeenCalledWith('/memories');
    const state = useMemoriesStore.getState();
    expect(state.memories).toEqual(memories as never);
    expect(state.loading).toBe(false);
  });

  test('loadMemories clears loading even when the request fails', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    await expect(useMemoriesStore.getState().loadMemories()).rejects.toThrow('boom');
    expect(useMemoriesStore.getState().loading).toBe(false);
  });

  test('createMemory posts and prepends the created memory', async () => {
    useMemoriesStore.setState({ memories: [mem('m1')] as never });
    const created = mem('m2', { title: 'New', content: 'Body', tags: ['x'] });
    post.mockResolvedValueOnce({ memory: created });
    await useMemoriesStore.getState().createMemory('New', 'Body', ['x']);
    expect(post).toHaveBeenCalledWith('/memories', {
      title: 'New',
      content: 'Body',
      tags: ['x'],
    });
    expect(useMemoriesStore.getState().memories.map((m) => m.id)).toEqual(['m2', 'm1']);
  });

  test('createMemory defaults tags to an empty array', async () => {
    post.mockResolvedValueOnce({ memory: mem('m1') });
    await useMemoriesStore.getState().createMemory('T', 'C');
    expect(post).toHaveBeenCalledWith('/memories', { title: 'T', content: 'C', tags: [] });
  });

  test('updateMemory patches and replaces the matching memory', async () => {
    useMemoriesStore.setState({ memories: [mem('m1'), mem('m2')] as never });
    const updated = mem('m1', { title: 'Updated', pinned: true });
    patch.mockResolvedValueOnce({ memory: updated });
    await useMemoriesStore.getState().updateMemory('m1', { title: 'Updated', pinned: true });
    expect(patch).toHaveBeenCalledWith('/memories/m1', { title: 'Updated', pinned: true });
    const state = useMemoriesStore.getState();
    expect(state.memories[0]).toEqual(updated as never);
    expect(state.memories[1]?.id).toBe('m2');
  });

  test('deleteMemory deletes and drops the memory from state', async () => {
    useMemoriesStore.setState({ memories: [mem('m1'), mem('m2')] as never });
    await useMemoriesStore.getState().deleteMemory('m1');
    expect(del).toHaveBeenCalledWith('/memories/m1');
    expect(useMemoriesStore.getState().memories.map((m) => m.id)).toEqual(['m2']);
  });
});
