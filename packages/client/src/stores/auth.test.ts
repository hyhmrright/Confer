import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// bun:test has no DOM — install a minimal in-memory localStorage shim.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const setToken = mock((_t: string | null) => {});
const setRefreshToken = mock((_t: string | null) => {});
mock.module('../lib/api.js', () => ({
  api: { get, post },
  setToken,
  setRefreshToken,
  getToken: mock(() => null),
}));

const { useAuthStore } = await import('./auth.js');

const initial = useAuthStore.getState();

const authResponse = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  user: { id: 'u1', username: 'alice', did: 'did:web:example.com:alice' },
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  setToken.mockReset();
  setRefreshToken.mockReset();
  localStorage.clear();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    refreshToken: null,
    loading: false,
    error: null,
  });
});

afterEach(() => {
  useAuthStore.setState(initial, true);
});

describe('auth store', () => {
  test('login stores tokens + user, persists to localStorage, and sets tokens', async () => {
    post.mockResolvedValueOnce(authResponse);
    await useAuthStore.getState().login('alice', 'secret');

    expect(post).toHaveBeenCalledWith('/auth/login', {
      username: 'alice',
      password: 'secret',
      device_id: expect.any(String),
    });
    expect(setToken).toHaveBeenCalledWith('access-1');
    expect(setRefreshToken).toHaveBeenCalledWith('refresh-1');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(authResponse.user as never);
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();

    const stored = JSON.parse(localStorage.getItem('confer_auth') ?? 'null');
    expect(stored).toEqual(authResponse);
  });

  test('login surfaces the error and rethrows on failure', async () => {
    post.mockRejectedValueOnce(new Error('bad credentials'));
    await expect(useAuthStore.getState().login('alice', 'wrong')).rejects.toThrow('bad credentials');

    const state = useAuthStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('bad credentials');
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(localStorage.getItem('confer_auth')).toBeNull();
    expect(setToken).not.toHaveBeenCalled();
  });

  test('register stores tokens + user and persists to localStorage', async () => {
    post.mockResolvedValueOnce(authResponse);
    await useAuthStore.getState().register('alice', 'secret', 'Alice');

    expect(post).toHaveBeenCalledWith('/auth/register', {
      username: 'alice',
      password: 'secret',
      display_name: 'Alice',
    });
    expect(setToken).toHaveBeenCalledWith('access-1');
    expect(setRefreshToken).toHaveBeenCalledWith('refresh-1');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(authResponse.user as never);
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
    expect(JSON.parse(localStorage.getItem('confer_auth') ?? 'null')).toEqual(authResponse);
  });

  test('register surfaces the error and rethrows on failure', async () => {
    post.mockRejectedValueOnce(new Error('username taken'));
    await expect(useAuthStore.getState().register('alice', 'secret')).rejects.toThrow(
      'username taken',
    );

    const state = useAuthStore.getState();
    expect(state.loading).toBe(false);
    expect(state.error).toBe('username taken');
    expect(state.user).toBeNull();
  });

  test('logout clears tokens/user/localStorage and clears the api tokens', () => {
    localStorage.setItem('confer_auth', JSON.stringify(authResponse));
    useAuthStore.setState({
      user: authResponse.user as never,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });

    useAuthStore.getState().logout();

    expect(setToken).toHaveBeenCalledWith(null);
    expect(setRefreshToken).toHaveBeenCalledWith(null);
    expect(localStorage.getItem('confer_auth')).toBeNull();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  test('restoreSession rehydrates tokens + user from localStorage', () => {
    localStorage.setItem('confer_auth', JSON.stringify(authResponse));

    useAuthStore.getState().restoreSession();

    expect(setToken).toHaveBeenCalledWith('access-1');
    expect(setRefreshToken).toHaveBeenCalledWith('refresh-1');

    const state = useAuthStore.getState();
    expect(state.user).toEqual(authResponse.user as never);
    expect(state.accessToken).toBe('access-1');
    expect(state.refreshToken).toBe('refresh-1');
  });

  test('restoreSession is a no-op when nothing is stored', () => {
    useAuthStore.getState().restoreSession();

    expect(setToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
  });

  test('restoreSession drops corrupt stored data', () => {
    localStorage.setItem('confer_auth', 'not-json');

    useAuthStore.getState().restoreSession();

    expect(localStorage.getItem('confer_auth')).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  test('refreshUser updates the user from /users/me', async () => {
    const fresh = { id: 'u1', username: 'alice', display_name: 'Alice Updated', did: 'did:web:x' };
    get.mockResolvedValueOnce({ user: fresh });

    await useAuthStore.getState().refreshUser();

    expect(get).toHaveBeenCalledWith('/users/me');
    expect(useAuthStore.getState().user).toEqual(fresh as never);
  });

  test('refreshUser swallows errors and keeps the existing user', async () => {
    useAuthStore.setState({ user: authResponse.user as never });
    get.mockRejectedValueOnce(new Error('network'));

    await useAuthStore.getState().refreshUser();

    expect(useAuthStore.getState().user).toEqual(authResponse.user as never);
  });
});
