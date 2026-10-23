// Narrows an unknown caught value to a message string, falling back to a caller
// -supplied default for non-Error throws. Centralizes the repeated
// `e instanceof Error ? e.message : '...'` pattern used across the stores.
export function captureError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

// The machine code and HTTP status an API failure carries (see `ApiError`).
// Read by shape rather than `instanceof`, so a caller need not import the
// class from `api.ts` — a module the component tests replace wholesale.
export function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

export function errorStatus(e: unknown): number | undefined {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}
