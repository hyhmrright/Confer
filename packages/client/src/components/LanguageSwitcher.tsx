import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n/index.js';

function isSupported(lng: string): lng is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng);
}

function current(lng: string): SupportedLanguage {
  return isSupported(lng) ? lng : 'en';
}

// Full select used on the settings page.
export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  return (
    <select
      value={current(i18n.language)}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      className="w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary focus:outline-none focus:border-primary-600/40 transition-colors appearance-none"
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <option key={lng} value={lng}>
          {t(`language.${lng}`)}
        </option>
      ))}
    </select>
  );
}

const SHORT_LABEL: Record<SupportedLanguage, string> = {
  en: 'EN',
  zh: '中',
  ja: 'あ',
};

// Compact cycling button used in the NavRail; clicking advances to the next
// supported language.
export function LanguageSwitcherCompact() {
  const { t, i18n } = useTranslation();
  const active = current(i18n.language);

  const cycle = () => {
    const idx = SUPPORTED_LANGUAGES.indexOf(active);
    const next = SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length];
    i18n.changeLanguage(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`${t('language.label')}: ${t(`language.${active}`)}`}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-[11px] font-semibold text-ink-muted hover:text-ink-secondary hover:bg-dark-hover transition-colors"
    >
      {SHORT_LABEL[active]}
    </button>
  );
}
