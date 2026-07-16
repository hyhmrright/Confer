// Hand-rolled bounded concurrency (no p-limit dependency — the gateway keeps a
// lean dependency surface). `boundedMap` caps in-flight work within one batch
// job; `IngestQueue` caps concurrent document ingestions across the process.

import { INGEST_CONCURRENCY } from './rag-config.js';

/**
 * Map `fn` over `items` with at most `limit` promises in flight at once,
 * returning results in input order. Errors reject the whole call (first error
 * wins), matching `Promise.all` semantics.
 */
export async function boundedMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

/**
 * A process-wide semaphore for fire-and-forget work. `submit` resolves once the
 * task has run to completion; callers over the limit wait their turn. This
 * bounds how many ingestions run at once so concurrent uploads queue instead of
 * thrashing the embedding API and Qdrant.
 */
export class IngestQueue {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async submit<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** Shared queue bounding concurrent document ingestions across the process. */
export const ingestQueue = new IngestQueue(INGEST_CONCURRENCY);
