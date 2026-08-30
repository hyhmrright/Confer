import { afterAll, describe, expect, test } from 'bun:test';
import i18n, { changeLanguage, dateLocale, resolveLanguage } from './index.js';

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
});
