import { describe, expect, test } from 'bun:test';
import { isValidId, newId } from './ulid.js';

describe('newId', () => {
  test('returns a valid 26-char ULID', () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(isValidId(id)).toBe(true);
  });

  test('returns a distinct value each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));
    expect(ids.size).toBe(100);
  });

  // Load-bearing, not a nicety. Rows are paged and windowed by id — the
  // alternative key, created_at, is `now()`, which is the transaction timestamp
  // and identical for every row a transaction writes. A plain ULID puts a fresh
  // random suffix on each id, so a batch minted inside one millisecond sorted
  // at random and the newest message fell out of the history window about half
  // the time. These are minted as fast as the machine can, which is the case
  // that used to break.
  test('sorts in the order it minted, even within one millisecond', () => {
    const ids = Array.from({ length: 500 }, () => newId());
    expect(ids).toEqual([...ids].sort());

    // And the run really did share milliseconds, or this proves nothing.
    const stamps = new Set(ids.map((id) => id.slice(0, 10)));
    expect(stamps.size).toBeLessThan(ids.length);
  });
});

describe('isValidId', () => {
  test('accepts a freshly generated id', () => {
    expect(isValidId(newId())).toBe(true);
  });

  test('rejects malformed ids', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId('too-short')).toBe(false);
    expect(isValidId('a'.repeat(26))).toBe(false); // lowercase not allowed
    expect(isValidId('I'.repeat(26))).toBe(false); // I is excluded in Crockford base32
    expect(isValidId(`${newId()}X`)).toBe(false); // 27 chars
  });
});
