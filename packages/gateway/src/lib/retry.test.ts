import { describe, expect, test } from 'bun:test';
import { HttpError, isRetryableError, retryWithBackoff } from './retry.js';

describe('isRetryableError', () => {
  test('retries HTTP 429 and 5xx', () => {
    expect(isRetryableError(new HttpError(429, 'rate limited'))).toBe(true);
    expect(isRetryableError(new HttpError(500, 'boom'))).toBe(true);
    expect(isRetryableError(new HttpError(503, 'unavailable'))).toBe(true);
  });

  test('does not retry 4xx client errors', () => {
    expect(isRetryableError(new HttpError(400, 'bad request'))).toBe(false);
    expect(isRetryableError(new HttpError(401, 'unauthorized'))).toBe(false);
    expect(isRetryableError(new HttpError(404, 'not found'))).toBe(false);
  });

  test('retries request timeouts (AbortError)', () => {
    const err = new Error('timed out');
    err.name = 'AbortError';
    expect(isRetryableError(err)).toBe(true);
  });

  test('does not retry unknown errors', () => {
    expect(isRetryableError(new Error('generic'))).toBe(false);
  });
});

describe('retryWithBackoff', () => {
  test('retries a 429 twice then succeeds on the third call', async () => {
    let calls = 0;
    // Simulate a fetch that returns 429 twice before a 200 (statuses drive the
    // real embedding/Qdrant wrappers, which throw HttpError on non-2xx).
    const mockFetch = async (): Promise<{ ok: boolean; status: number }> => {
      calls++;
      if (calls < 3) return { ok: false, status: 429 };
      return { ok: true, status: 200 };
    };

    const result = await retryWithBackoff(
      async () => {
        const res = await mockFetch();
        if (!res.ok) throw new HttpError(res.status, `failed ${res.status}`);
        return 'ok';
      },
      { baseDelayMs: 1 },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  test('fails immediately on a 4xx without retrying', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new HttpError(400, 'bad request');
        },
        { baseDelayMs: 1 },
      ),
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  test('gives up after exhausting retries and rethrows the last error', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new HttpError(503, 'still down');
        },
        { retries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('still down');
    expect(calls).toBe(3);
  });
});
