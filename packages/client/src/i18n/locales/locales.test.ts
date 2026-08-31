import { describe, expect, test } from 'bun:test';
import { ar } from './ar.js';
import { bn } from './bn.js';
import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { hi } from './hi.js';
import { ja } from './ja.js';
import { pt } from './pt.js';
import { ru } from './ru.js';
import { ur } from './ur.js';
import { zh } from './zh.js';

const LOCALES = { en, zh, hi, es, ar, fr, bn, pt, ru, ur, ja };

// Every language names every other language in *that other* language, so the
// eleven `language` blocks are byte-identical apart from `label`. That is real
// duplication, and hoisting it into a shared module was tried and reverted: any
// module eleven lazy chunks import becomes a chunk of its own, and Rollup did
// exactly that — a 213-byte file the preload hint does not cover, so every
// first-time visitor paid a serial round trip that is only discovered once
// their locale chunk has downloaded and parsed. 128 compressed bytes is not
// worth a round trip on a slow link.
//
// So the duplication stays and this guards it instead, at no runtime cost.
// `Resources` already forces every locale to *have* the keys; what it cannot
// see is a value drifting — someone translating '简体中文' into 'Chinois' in
// fr.ts, which reads like a fix and breaks the one property that makes the
// switcher usable: that you can find your own language without being able to
// read the interface it is currently in.
describe('language names', () => {
  const entries = Object.entries(LOCALES);

  test('are the same in every locale, so the switcher is readable from any of them', () => {
    const canonical = { ...en.language, label: undefined };
    for (const [, resources] of entries) {
      expect({ ...resources.language, label: undefined }).toEqual(canonical);
      // `label` is the one entry that *should* differ — it is the word
      // "Language" itself, which belongs to the surrounding UI.
      expect(resources.language.label).not.toBe('');
    }
    // Guard the guard: if `label` were compared too, the loop above would pass
    // only when every locale is identical, which is not what is being asserted.
    expect(new Set(entries.map(([, r]) => r.language.label)).size).toBeGreaterThan(1);
  });

  test('cover exactly the languages that ship, no more and no fewer', () => {
    for (const [code, resources] of entries) {
      const named = Object.keys(resources.language).filter((k) => k !== 'label');
      expect(named.sort()).toEqual(Object.keys(LOCALES).sort());
      // And the locale names itself, which is the entry its own switcher shows
      // as selected.
      expect(named).toContain(code);
    }
  });
});
