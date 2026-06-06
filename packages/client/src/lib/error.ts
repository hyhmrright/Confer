// Narrows an unknown caught value to a message string, falling back to a caller
// -supplied default for non-Error throws. Centralizes the repeated
// `e instanceof Error ? e.message : '...'` pattern used across the stores.
export function captureError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
