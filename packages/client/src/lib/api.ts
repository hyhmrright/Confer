const BASE_URL = '/api/v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onTokenRefreshed: (() => void) | null = null;
let onAuthExpired: (() => void) | null = null;

// Let other modules (e.g. the WebSocket layer) react when the access token is
// rotated, so a connection opened with a now-stale token can reconnect.
export function setOnTokenRefreshed(cb: (() => void) | null) {
  onTokenRefreshed = cb;
}

// Let the auth store react when the refresh token itself is rejected (expired,
// revoked, or minted before a breaking session-format change), so every
// caller gets kicked back to the login screen instead of showing a stale
// error forever.
export function setOnAuthExpired(cb: (() => void) | null) {
  onAuthExpired = cb;
}

export function setToken(token: string | null) {
  accessToken = token;
}

export function setRefreshToken(token: string | null) {
  refreshToken = token;
}

export function getToken(): string | null {
  return accessToken;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    const stored = localStorage.getItem('confer_auth');
    if (stored) {
      const parsed = JSON.parse(stored);
      parsed.access_token = data.access_token;
      parsed.refresh_token = data.refresh_token;
      localStorage.setItem('confer_auth', JSON.stringify(parsed));
    }
    onTokenRefreshed?.();
    return true;
  } catch {
    return false;
  }
}

// Runs `fetch`, and on a 401 attempts one refresh-and-retry. Any 401 that
// survives this (no refresh token to try, refresh itself rejected, or the
// retried request 401s again) is unrecoverable, so it fires onAuthExpired —
// shared by every caller (JSON requests and the multipart upload) so none of
// them can silently sit on a dead session.
async function fetchWithAuth(path: string, options: RequestInit): Promise<Response> {
  const withAuthHeader = (): RequestInit => ({
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  const res = await fetch(`${BASE_URL}${path}`, withAuthHeader());
  if (res.status !== 401) return res;

  if (!refreshToken) {
    onAuthExpired?.();
    return res;
  }

  if (!refreshing) {
    refreshing = tryRefresh().then((ok) => {
      refreshing = null;
      if (!ok) onAuthExpired?.();
      return ok;
    });
  }
  const ok = await refreshing;
  if (!ok) return res;

  const retry = await fetch(`${BASE_URL}${path}`, withAuthHeader());
  if (retry.status === 401) onAuthExpired?.();
  return retry;
}

async function parseOrThrow<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? fallbackMessage, body?.error?.code);
  }
  return res.json();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetchWithAuth(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers as Record<string, string>) },
  });
  return parseOrThrow<T>(res, 'Request failed');
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// Structural type for the HTTP client. Exported as a seam so callers (and tests)
// can depend on the interface rather than the concrete `api` object's inferred
// shape. Adding this changes no runtime behavior.
export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body: unknown) => Promise<T>;
  patch: <T>(path: string, body: unknown) => Promise<T>;
  put: <T>(path: string, body: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
  postForm: <T>(path: string, form: FormData) => Promise<T>;
}

export const api: ApiClient = {
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  get: <T>(path: string) => request<T>(path),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    const res = await fetchWithAuth(path, { method: 'POST', body: form });
    return parseOrThrow<T>(res, 'Upload failed');
  },
};
