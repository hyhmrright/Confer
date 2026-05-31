const BASE_URL = '/api/v1';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<void> | null = null;
let onTokenRefreshed: (() => void) | null = null;

// Let other modules (e.g. the WebSocket layer) react when the access token is
// rotated, so a connection opened with a now-stale token can reconnect.
export function setOnTokenRefreshed(cb: (() => void) | null) {
  onTokenRefreshed = cb;
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && refreshToken) {
    if (!refreshing) {
      refreshing = tryRefresh().then((ok) => {
        refreshing = null;
        if (!ok) throw new ApiError(401, 'Session expired', 'unauthorized');
      });
    }
    await refreshing;
    headers.Authorization = `Bearer ${accessToken}`;
    const retry = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    if (!retry.ok) {
      const body = await retry.json().catch(() => ({}));
      throw new ApiError(retry.status, body?.error?.message ?? 'Request failed', body?.error?.code);
    }
    return retry.json();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.error?.message ?? 'Request failed', body?.error?.code);
  }

  return res.json();
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

export const api = {
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),

  get: <T>(path: string) => request<T>(path),

  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),

  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),

  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  postForm: async <T>(path: string, form: FormData): Promise<T> => {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = body?.error as Record<string, unknown> | undefined;
      throw new ApiError(
        res.status,
        (err?.message as string) ?? 'Upload failed',
        err?.code as string | undefined,
      );
    }
    return res.json() as Promise<T>;
  },
};
