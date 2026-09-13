import { apiBase } from './gateway.js';

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

// Tabs share one session and one refresh token — restoreSession reads the same
// stored copy — and the gateway reads a refresh token presented twice as theft
// and destroys the session. So a second tab refreshing on its own logged every
// tab out, and since the gateway closes a socket when its token expires, every
// open tab now refreshes at the same moment. Refreshes are therefore serialised
// across tabs where the browser can, and a tab whose session another tab has
// already rotated takes that pair rather than spending its own.
function tryRefresh(): Promise<boolean> {
  return navigator.locks
    ? navigator.locks.request('confer-token-refresh', refreshOnce)
    : refreshOnce();
}

async function refreshOnce(): Promise<boolean> {
  try {
    const stored = JSON.parse(localStorage.getItem('confer_auth') ?? 'null');
    const session = sessionOf(accessToken);
    if (
      stored &&
      session &&
      stored.refresh_token !== refreshToken &&
      sessionOf(stored.access_token) === session
    ) {
      accessToken = stored.access_token;
      refreshToken = stored.refresh_token;
      onTokenRefreshed?.();
      return true;
    }
    if (!refreshToken) return false;

    const res = await fetch(`${apiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;

    const data = await res.json();
    accessToken = data.access_token;
    refreshToken = data.refresh_token;

    if (stored) {
      stored.access_token = data.access_token;
      stored.refresh_token = data.refresh_token;
      localStorage.setItem('confer_auth', JSON.stringify(stored));
    }
    onTokenRefreshed?.();
    return true;
  } catch {
    return false;
  }
}

// The session an access token belongs to, or undefined for anything that is
// not one of ours. Read, not verified: it only decides whether a stored pair is
// this tab's session rotated by another tab, or a different login altogether.
function sessionOf(token: string | null): string | undefined {
  try {
    const payload = (token ?? '').split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.sid === 'string' ? claims.sid : undefined;
  } catch {
    return undefined;
  }
}

// Renew the access token once, however many callers ask at the same moment. A
// refresh that fails means the session is gone, which every caller handles the
// same way, so onAuthExpired fires here rather than at each of them.
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = tryRefresh().then((ok) => {
      refreshing = null;
      if (!ok) onAuthExpired?.();
      return ok;
    });
  }
  return refreshing;
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

  const res = await fetch(`${apiBase()}${path}`, withAuthHeader());
  if (res.status !== 401) return res;

  if (!refreshToken) {
    onAuthExpired?.();
    return res;
  }

  const ok = await refreshSession();
  if (!ok) return res;

  const retry = await fetch(`${apiBase()}${path}`, withAuthHeader());
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
