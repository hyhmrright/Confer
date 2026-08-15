import { describe, expect, test } from 'bun:test';
import { appendNew, prependNew } from './list.js';

const row = (id: string) => ({ id });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('appendNew', () => {
  test('joins the next page after what is shown', () => {
    expect(ids(appendNew([row('a'), row('b')], [row('c'), row('d')]))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  // The case this exists for: offset paging re-serves a row because the list
  // shrank underneath the window.
  test('drops rows already on screen', () => {
    expect(ids(appendNew([row('a'), row('b')], [row('b'), row('c')]))).toEqual(['a', 'b', 'c']);
  });

  test('keeps the shown list untouched when the page is entirely stale', () => {
    const shown = [row('a')];
    expect(ids(appendNew(shown, [row('a')]))).toEqual(['a']);
  });

  test('does not mutate its arguments', () => {
    const shown = [row('a')];
    const page = [row('b')];
    appendNew(shown, page);
    expect(shown).toHaveLength(1);
    expect(page).toHaveLength(1);
  });
});

describe('prependNew', () => {
  test('joins an older page before what is shown', () => {
    expect(ids(prependNew([row('c'), row('d')], [row('a'), row('b')]))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  // Keyset paging can overlap on the boundary row.
  test('drops rows already on screen and keeps their existing position', () => {
    expect(ids(prependNew([row('b'), row('c')], [row('a'), row('b')]))).toEqual(['a', 'b', 'c']);
  });

  test('handles an empty page', () => {
    expect(ids(prependNew([row('a')], []))).toEqual(['a']);
  });
});
