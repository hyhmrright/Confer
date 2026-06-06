import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// api.ts uses global fetch + localStorage and holds module-level token state.
// Install an in-memory localStorage shim (bun:test has no DOM).
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

const fetchMock = mock(async (_url: string, _init?: RequestInit) => jsonResponse({}));
globalThis.fetch = fetchMock as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

// Other test files globally `mock.module('../lib/api.js')` with partial stubs
// (the documented cross-file leakage). Import via a query-suffixed specifier so
// we load the REAL module here regardless of those registrations. The specifier
// is built at runtime + cast so TS still resolves the module's types.
type ApiModule = typeof import('./api.js');
const realApiModule = (await import(/* @vite-ignore */ `${'./api.js'}?real`)) as ApiModule;
const { api, ApiError, setToken, setRefreshToken } = realApiModule;

beforeEach(() => {
  fetchMock.mockReset();
  localStorage.clear();
  setToken(null);
  setRefreshToken(null);
});

afterEach(() => {
  setToken(null);
  setRefreshToken(null);
});

describe('api client', () => {
  test('get sends the Authorization header when a token is set', async () => {
    setToken('tok-1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const out = await api.get<{ ok: boolean }>('/things');

    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/things');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  test('get omits Authorization when no token is set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await api.get('/public');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('post serializes the body and sets the JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'x' }));
    await api.post('/things', { name: 'a' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/things');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'a' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('maps a non-2xx error body into an ApiError with status/code/message', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'nope', code: 'bad_input' } }, 400),
    );
    const err = (await api.get('/things').catch((e: unknown) => e)) as InstanceType<
      typeof ApiError
    >;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.message).toBe('nope');
    expect(err.code).toBe('bad_input');
  });

  test('falls back to a default message when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    const err = (await api.get('/things').catch((e: unknown) => e)) as InstanceType<
      typeof ApiError
    >;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Request failed');
  });

  test('on 401 refreshes the token and retries the original request', async () => {
    setToken('stale');
    setRefreshToken('refresh-1');
    fetchMock
      // 1: original request -> 401
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // 2: refresh -> new tokens
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh', refresh_token: 'refresh-2' }))
      // 3: retry -> success
      .mockResolvedValueOnce(jsonResponse({ value: 42 }));

    const out = await api.get<{ value: number }>('/secure');

    expect(out).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const refreshCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(refreshCall[0]).toBe('/api/v1/auth/refresh');
    // The retry carries the refreshed access token.
    const retryCall = fetchMock.mock.calls[2] as [string, RequestInit];
    expect((retryCall[1].headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  test('persists the refreshed tokens back into stored auth', async () => {
    localStorage.setItem(
      'confer_auth',
      JSON.stringify({ access_token: 'stale', refresh_token: 'refresh-1', user: { id: 'u1' } }),
    );
    setToken('stale');
    setRefreshToken('refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'fresh', refresh_token: 'refresh-2' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    await api.get('/secure');

    const stored = JSON.parse(localStorage.getItem('confer_auth') ?? '{}');
    expect(stored.access_token).toBe('fresh');
    expect(stored.refresh_token).toBe('refresh-2');
    expect(stored.user).toEqual({ id: 'u1' });
  });

  test('throws a 401 ApiError when the refresh itself fails', async () => {
    setToken('stale');
    setRefreshToken('refresh-1');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // refresh fails
      .mockResolvedValueOnce(jsonResponse({}, 401));

    const err = (await api.get('/secure').catch((e: unknown) => e)) as InstanceType<
      typeof ApiError
    >;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    // Original request + refresh attempt only; no retry happened.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not attempt a refresh on 401 when there is no refresh token', async () => {
    setToken('stale');
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'unauth' } }, 401));
    const err = (await api.get('/secure').catch((e: unknown) => e)) as InstanceType<
      typeof ApiError
    >;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('postForm sends the FormData body with the auth header and no JSON content type', async () => {
    setToken('tok-1');
    fetchMock.mockResolvedValueOnce(jsonResponse({ document: { id: 'd1' } }));
    const form = new FormData();
    form.append('file', new File(['x'], 'a.txt'));

    const out = await api.postForm<{ document: { id: string } }>('/upload', form);

    expect(out).toEqual({ document: { id: 'd1' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/upload');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  test('postForm maps an error response into an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { message: 'too big', code: 'too_large' } }, 413),
    );
    const err = (await api
      .postForm('/upload', new FormData())
      .catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(413);
    expect(err.message).toBe('too big');
    expect(err.code).toBe('too_large');
  });
});
