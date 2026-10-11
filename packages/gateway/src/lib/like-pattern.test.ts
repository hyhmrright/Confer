import { describe, expect, test } from 'bun:test';
import { containsPattern } from './like-pattern.js';

describe('containsPattern', () => {
  test('wraps plain text in wildcards', () => {
    expect(containsPattern('报价')).toBe('%报价%');
  });

  test('escapes the characters LIKE treats as wildcards, and the escape itself', () => {
    expect(containsPattern('100%_off\\now')).toBe('%100\\%\\_off\\\\now%');
  });
});
