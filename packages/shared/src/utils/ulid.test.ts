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
