import { afterAll, describe, expect, test } from 'bun:test';
import i18n, { changeLanguage, dateLocale, languageDirection, resolveLanguage } from './index.js';

// Every real browser reports a region — `zh-CN`, `ja-JP`, `en-GB` — and
// `i18n.language` keeps it. Matching that raw value against the supported list
// fails, and the failure is silent: it answers `en`, which looks like a
// deliberate choice rather than a miss. That shipped, and it meant a Chinese or
// Japanese visitor's FIRST page load was in English, with US-formatted dates and
// a settings dropdown claiming English was their selection. Only someone who had
// already used the switcher escaped it, because that writes a bare code back.
describe('resolveLanguage', () => {
  test('passes a bare supported code through', () => {
    expect(resolveLanguage('zh')).toBe('zh');
    expect(resolveLanguage('en')).toBe('en');
    expect(resolveLanguage('ja')).toBe('ja');
  });

  test('strips the region a browser actually sends', () => {
    expect(resolveLanguage('zh-CN')).toBe('zh');
    expect(resolveLanguage('zh-TW')).toBe('zh');
    expect(resolveLanguage('ja-JP')).toBe('ja');
    expect(resolveLanguage('en-US')).toBe('en');
  });

  test('falls back to en for anything we do not translate', () => {
    expect(resolveLanguage('de-DE')).toBe('en');
    expect(resolveLanguage('')).toBe('en');
    expect(resolveLanguage('-')).toBe('en');
  });
});

// `dir` is the entire RTL mechanism: every positional style is written in
// logical properties, which the browser mirrors only once the attribute is set.
// Getting it wrong is not a subtle bug — the layout either mirrors or it does
// not — but it is silent in a suite that never asserts on the attribute.
describe('languageDirection', () => {
  test('reports rtl for a right-to-left language', () => {
    expect(languageDirection('ar')).toBe('rtl');
  });

  test('reports ltr for the rest', () => {
    expect(languageDirection('en')).toBe('ltr');
    expect(languageDirection('zh')).toBe('ltr');
    expect(languageDirection('ja')).toBe('ltr');
  });

  // Same trap resolveLanguage exists for: a browser sends `ar-EG`, never `ar`.
  // Comparing the raw code against the RTL set would leave every real Arabic
  // visitor in a left-to-right layout.
  test('strips the region a browser actually sends', () => {
    expect(languageDirection('ar-EG')).toBe('rtl');
    expect(languageDirection('ar-SA')).toBe('rtl');
  });

  test('treats an untranslated language as ltr, matching its en fallback', () => {
    expect(languageDirection('de-DE')).toBe('ltr');
  });
});

describe('language resolution end to end', () => {
  const original = i18n.language;
  afterAll(async () => {
    await changeLanguage(original);
  });

  // The bug in one assertion: asking for a region-tagged Chinese used to load
  // the *English* bundle, so the UI stayed English while i18next reported it was
  // on zh-CN. It also cost a second network round trip — the preload hint had
  // already fetched `zh` while the runtime went and got `en` as well.
  test('a region-tagged code loads that language, not the fallback', async () => {
    await changeLanguage('zh-CN');

    expect(i18n.hasResourceBundle('zh', 'translation')).toBe(true);
    expect(i18n.t('login.welcomeBack')).toBe('欢迎回来');
  });

  test('dates follow the resolved language, not the raw code', async () => {
    await changeLanguage('zh-CN');
    expect(dateLocale()).toBe('zh-CN');

    await changeLanguage('ja');
    expect(dateLocale()).toBe('ja-JP');
  });

  // The unit test above proves the function; this proves it is actually wired
  // to the document. A correct `languageDirection` that nothing calls would
  // leave Arabic rendering left-to-right, and no other assertion would notice.
  test('switching to an RTL language mirrors the document, and back again', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');

    await changeLanguage('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en-US');
  });

  test('the Arabic bundle loads its own strings, not the fallback', async () => {
    await changeLanguage('ar');
    expect(i18n.hasResourceBundle('ar', 'translation')).toBe(true);
    expect(i18n.t('login.welcomeBack')).toBe('أهلًا بعودتك');
  });
});
