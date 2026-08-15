import { describe, expect, test } from 'bun:test';
import { parseLimit, parseOffset } from './pagination.js';

describe('parseLimit', () => {
  test('takes a well-formed value', () => {
    expect(parseLimit('25', 50, 100)).toBe(25);
  });

  test('falls back when the parameter is absent', () => {
    expect(parseLimit(undefined, 50, 100)).toBe(50);
  });

  test('clamps to the maximum rather than trusting the caller', () => {
    expect(parseLimit('5000', 50, 100)).toBe(100);
  });

  // The reason this helper exists: `Math.min(Number('abc'), 100)` is NaN, and
  // Drizzle passes that straight through as `LIMIT NaN`, so a junk query string
  // became a 500 from Postgres instead of a clamp at the boundary.
  test.each([['abc'], [''], ['NaN'], ['Infinity'], ['1e400']])(
    'falls back on unparseable input %p',
    (raw) => {
      expect(parseLimit(raw, 50, 100)).toBe(50);
    },
  );

  test.each([['0'], ['-1'], ['-9999']])('falls back on non-positive input %p', (raw) => {
    expect(parseLimit(raw, 50, 100)).toBe(50);
  });
});

describe('parseOffset', () => {
  test('takes a well-formed value', () => {
    expect(parseOffset('120')).toBe(120);
  });

  test('defaults to the start of the list', () => {
    expect(parseOffset(undefined)).toBe(0);
  });

  // Unlike limit, zero is the normal case here and must survive.
  test('keeps an explicit zero', () => {
    expect(parseOffset('0')).toBe(0);
  });

  test.each([['-5'], ['abc'], ['']])('falls back to zero on %p', (raw) => {
    expect(parseOffset(raw)).toBe(0);
  });
});
