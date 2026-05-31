// Shared Qdrant HTTP client. Both the knowledge-base (qdrant.ts) and memory
// (memory-store.ts) collections talk to the same Qdrant instance through these
// helpers, so the URL resolution, timeouts, and error shape stay in one place.

export const QDRANT_REQUEST_TIMEOUT_MS = 30_000;
export const QDRANT_HEALTHCHECK_TIMEOUT_MS = 10_000;

export function qdrantUrl(path: string): string {
  const base = process.env.QDRANT_URL ?? 'http://localhost:6333';
  return `${base}${path}`;
}

export async function qdrantRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(qdrantUrl(path), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(QDRANT_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}
