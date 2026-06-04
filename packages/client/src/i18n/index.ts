import i18n, { type ParseKeys } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en.js';
import { ja } from './locales/ja.js';
import { zh } from './locales/zh.js';

export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// A statically-checked translation key (e.g. 'settings.title'). Use this to
// type fields that hold an i18n key for later lookup via t(key).
export type TranslationKey = ParseKeys;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    load: 'languageOnly',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'confer_lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

const DATE_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-US',
  zh: 'zh-CN',
  ja: 'ja-JP',
};

// BCP-47 locale string for date/time formatting, derived from the active UI
// language. Falls back to en-US for any unexpected i18n.language value.
export function dateLocale(): string {
  return DATE_LOCALES[i18n.language as SupportedLanguage] ?? 'en-US';
}

export default i18n;
