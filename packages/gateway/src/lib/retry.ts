// Shared exponential-backoff retry for network calls (embedding API, Qdrant).
// Only transient failures are retried — HTTP 429 / 5xx and request timeouts
// (AbortError from AbortSignal.timeout). 4xx client errors fail immediately, as
// retrying a bad request just burns time and rate-limit budget.

/** Error carrying an HTTP status so `isRetryableError` can classify it. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface RetryOptions {
  /** Maximum total attempts (initial call included). */
  retries?: number;
  /** Base delay for the first backoff, doubled each retry. */
  baseDelayMs?: number;
  /** Classifier for whether a thrown error should be retried. */
  isRetryable?: (err: unknown) => boolean;
}

/** True for HTTP 429/5xx and request timeouts; false for 4xx and everything else. */
export function isRetryableError(err: unknown): boolean {
  // AbortSignal.timeout() rejects with a DOMException/Error named 'AbortError'.
  if (err instanceof Error && err.name === 'AbortError') return true;
  if (err instanceof HttpError) return err.status === 429 || err.status >= 500;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;
  const isRetryable = opts.isRetryable ?? isRetryableError;

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      // Exponential backoff (250 → 500 → 1000 …) with up to 25% jitter to
      // avoid synchronized retries across concurrent callers.
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay + Math.random() * delay * 0.25);
    }
  }
}
