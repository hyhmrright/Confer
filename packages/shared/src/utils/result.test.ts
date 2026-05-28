import { describe, expect, test } from 'bun:test';
import { err, ok } from './result.js';

describe('Result helpers', () => {
  test('ok wraps a value', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  test('err wraps an error', () => {
    const r = err('boom');
    expect(r).toEqual({ ok: false, error: 'boom' });
  });
});
