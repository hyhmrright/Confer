import { useTranslation } from 'react-i18next';
import {
  changeLanguage,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../i18n/index.js';
import { SELECT_FIELD_CLS } from '../lib/styles.js';

// Full select used on the settings page. `id` lets the caller's FieldLabel bind
// to the select, which is the only way the label reaches assistive tech.
export function LanguageSwitcher({ id }: { id?: string }) {
  const { t, i18n } = useTranslation();

  return (
    <select
      id={id}
      value={resolveLanguage(i18n.language)}
      onChange={(e) => void changeLanguage(e.target.value)}
      className={SELECT_FIELD_CLS}
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
  const active = resolveLanguage(i18n.language);

  const cycle = () => {
    const idx = SUPPORTED_LANGUAGES.indexOf(active);
    const next = SUPPORTED_LANGUAGES[(idx + 1) % SUPPORTED_LANGUAGES.length];
    void changeLanguage(next);
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
