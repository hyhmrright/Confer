import { describe, expect, test } from 'bun:test';
import { snippetAround } from './snippet.js';

describe('snippetAround', () => {
  test('returns short content whole, on one line', () => {
    expect(snippetAround('Q3\n报价  已发', '报价')).toBe('Q3 报价 已发');
  });

  test('centres a match deep inside long content, marking both cuts', () => {
    const content = `${'a'.repeat(100)}NEEDLE${'b'.repeat(100)}`;
    expect(snippetAround(content, 'needle', 5)).toBe('…aaaaaNEEDLEbbbbb…');
  });

  test('marks only the end when the match is near the start', () => {
    expect(snippetAround(`hit ${'x'.repeat(100)}`, 'hit', 4)).toBe('hit xxx…');
  });

  test('falls back to the opening when the query is not in the text', () => {
    expect(snippetAround('x'.repeat(20), 'nope', 5)).toBe('xxxxxxxxxx…');
  });
});
