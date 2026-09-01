import i18n, { type ParseKeys } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import type { Resources } from './locales/zh.js';

// The ten most-spoken languages by total speakers, plus Japanese, which this
// app already shipped. Ordered by that ranking rather than alphabetically, so
// the switcher's list reads as a deliberate order instead of an accident of
// spelling — and so the reason a language is here is visible from the order.
export const SUPPORTED_LANGUAGES = [
  'en',
  'zh',
  'hi',
  'es',
  'ar',
  'fr',
  'bn',
  'pt',
  'ru',
  'ur',
  'ja',
] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// A statically-checked translation key (e.g. 'settings.title'). Use this to
// type fields that hold an i18n key for later lookup via t(key).
export type TranslationKey = ParseKeys;

// Dynamic imports, so a visitor downloads the one language they read instead of
// all three — 7.8 KB gzip of the initial chunk was the other two. Safe to load
// only one because every locale is typed as `Resources`, making the key sets
// identical by construction: `fallbackLng` has nothing to fall back *to*, so it
// never fires for a missing key.
//
// Written out rather than built from SUPPORTED_LANGUAGES because the specifier
// has to be statically analysable — a computed one makes Rollup give up and
// bundle all three back into the caller.
const LOADERS: Record<SupportedLanguage, () => Promise<Resources>> = {
  en: () => import('./locales/en.js').then((m) => m.en),
  zh: () => import('./locales/zh.js').then((m) => m.zh),
  hi: () => import('./locales/hi.js').then((m) => m.hi),
  es: () => import('./locales/es.js').then((m) => m.es),
  ar: () => import('./locales/ar.js').then((m) => m.ar),
  fr: () => import('./locales/fr.js').then((m) => m.fr),
  bn: () => import('./locales/bn.js').then((m) => m.bn),
  pt: () => import('./locales/pt.js').then((m) => m.pt),
  ru: () => import('./locales/ru.js').then((m) => m.ru),
  ur: () => import('./locales/ur.js').then((m) => m.ur),
  ja: () => import('./locales/ja.js').then((m) => m.ja),
};

function isSupported(lng: string): lng is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

/**
 * The language a code actually maps to, region stripped.
 *
 * Every place that indexes by language must go through this. `i18n.language`
 * keeps whatever the detector found, region and all, and a real browser reports
 * `zh-CN` or `ja-JP` — never a bare `zh`. Matching the raw value against
 * SUPPORTED_LANGUAGES therefore fails for almost every genuine visitor and
 * quietly answers `en`, which is a plausible-looking wrong answer rather than an
 * error: a first-time Chinese visitor was served the English bundle, the
 * settings dropdown showed English as their choice, and their dates came out
 * US-formatted. Only someone who had already used the switcher was right, since
 * that writes a bare code back to localStorage.
 *
 * i18next itself does this normalisation — `load: 'languageOnly'` is why
 * `i18n.languages` reads `['zh', 'en']` while `i18n.language` reads `zh-CN`. We
 * need the same answer on our side of the boundary.
 */
export function resolveLanguage(lng: string): SupportedLanguage {
  const base = lng.split('-')[0] ?? '';
  return isSupported(base) ? base : 'en';
}

// Scripts that run right to left.
//
// Setting `dir` is the whole mechanism: every positional style in this app is
// written in logical properties (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
// `text-start`), which the browser mirrors on its own once the attribute is
// there. Transforms are the one thing it cannot mirror, since CSS has no
// logical translate — those are handled at their two call sites, both marked.
const RTL_LANGUAGES: ReadonlySet<SupportedLanguage> = new Set(['ar', 'ur']);

// Goes through resolveLanguage for the same reason dateLocale does: a browser
// sends `ar-EG`, and matching the raw code would leave every real Arabic
// visitor in a left-to-right layout.
export function languageDirection(lng: string): 'ltr' | 'rtl' {
  return RTL_LANGUAGES.has(resolveLanguage(lng)) ? 'rtl' : 'ltr';
}

async function loadResources(lng: string): Promise<void> {
  const key = resolveLanguage(lng);
  if (i18n.hasResourceBundle(key, 'translation')) return;
  i18n.addResourceBundle(key, 'translation', await LOADERS[key]());
}

// Switch language, resources first. Calling i18next's own changeLanguage
// directly would announce the switch before the bundle existed, and every
// string on screen would flash its raw key for a frame.
//
// The ticket guards an ordering the old synchronous switch could not get wrong:
// each language's first switch is a real fetch, so two quick clicks on the
// compact switcher have two imports racing, and the slower one would win the
// last word regardless of which was asked for last.
let latestRequest = 0;

export async function changeLanguage(lng: string): Promise<void> {
  const ticket = ++latestRequest;
  await loadResources(lng);
  if (ticket !== latestRequest) return;
  await i18n.changeLanguage(lng);
}

let started: Promise<void> | undefined;

// Await before the first render. Resolving after this point means the tree can
// mount with its strings already in place.
export function initI18n(): Promise<void> {
  started ??= i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: {},
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_LANGUAGES,
      load: 'languageOnly',
      detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: 'confer_lang',
        caches: ['localStorage'],
      },
      interpolation: { escapeValue: false },
    })
    .then(() => loadResources(i18n.language))
    .then(syncDocumentLang);
  return started;
}

const DATE_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  hi: 'hi-IN',
  // The region decides the date order and the numeral system, so it is chosen
  // by where most speakers are — pt-BR over pt-PT, bn-BD over bn-IN. Arabic is
  // the one left bare: its speakers span two dozen countries with no region
  // more canonical than the others, and picking one would impose that
  // country's conventions on everyone else.
  es: 'es-ES',
  ar: 'ar',
  fr: 'fr-FR',
  bn: 'bn-BD',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ur: 'ur-PK',
  ja: 'ja-JP',
};

// BCP-47 locale string for date/time formatting, derived from the active UI
// language. Goes through resolveLanguage because i18n.language carries a region
// the table is not keyed by.
export function dateLocale(): string {
  return DATE_LOCALES[resolveLanguage(i18n.language)];
}

// The served index.html can only carry one static `lang`, so it is wrong for
// every UI language but one — and that attribute is what tells a screen reader
// which voice to use. Keep it on the real language instead, reusing the same
// BCP-47 tags the date formatter maps to.
//
// `dir` rides along because it has the same trigger and the same failure mode
// if it drifts: set from anywhere else, a language switch would leave the
// attribute describing the previous language's script and mirror the entire
// layout the wrong way.
function syncDocumentLang() {
  document.documentElement.lang = dateLocale();
  document.documentElement.dir = languageDirection(i18n.language);
}
i18n.on('languageChanged', syncDocumentLang);

export default i18n;
