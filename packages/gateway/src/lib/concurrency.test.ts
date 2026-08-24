import { describe, expect, test } from 'bun:test';
import { boundedMap, IngestQueue } from './concurrency.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('boundedMap', () => {
  test('never runs more than `limit` tasks concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    const results = await boundedMap(items, 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(results).toEqual(items.map((n) => n * 2));
  });

  test('preserves input order even when tasks finish out of order', async () => {
    const items = [30, 10, 20];
    const results = await boundedMap(items, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(results).toEqual([0, 1, 2]);
  });

  test('handles an empty input without invoking fn', async () => {
    let called = false;
    const results = await boundedMap<number, number>([], 3, async (n) => {
      called = true;
      return n;
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  test('propagates the first rejection', async () => {
    await expect(
      boundedMap([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('IngestQueue', () => {
  test('bounds concurrent tasks to the configured limit', async () => {
    const queue = new IngestQueue(2);
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());

    const submissions = gates.map((gate) =>
      queue.submit(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight--;
      }),
    );

    // Let the first wave acquire slots, then release everything in order.
    await new Promise((r) => setTimeout(r, 10));
    expect(inFlight).toBe(2);
    for (const gate of gates) {
      gate.resolve();
      await new Promise((r) => setTimeout(r, 1));
    }

    await Promise.all(submissions);
    expect(peak).toBe(2);
  });

  test('releases its slot even when a task throws', async () => {
    const queue = new IngestQueue(1);
    await expect(queue.submit(async () => Promise.reject(new Error('fail')))).rejects.toThrow(
      'fail',
    );
    // A subsequent task must still be able to acquire the freed slot.
    expect(await queue.submit(async () => 'ok')).toBe('ok');
  });
});
