import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  changeLanguage,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../i18n/index.js';
import { SELECT_FIELD_CLS } from '../lib/styles.js';
import { useDismissable } from '../lib/use-dismissable.js';

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

// One glyph per language for the rail button — a word would not fit in 36px.
const SHORT_LABEL: Record<SupportedLanguage, string> = {
  en: 'EN',
  zh: '中',
  ja: 'あ',
  ar: 'ع',
};

/**
 * Compact language picker for the NavRail.
 *
 * This used to be a button that cycled to the next language on each click,
 * which reads fine at three languages and breaks down past that: reaching your
 * own language could take ten clicks, each one repainting the whole app in a
 * language you cannot read on the way. It opens a list instead.
 */
export function LanguageSwitcherCompact() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = resolveLanguage(i18n.language);

  useDismissable(rootRef, open, () => setOpen(false));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${t('language.label')}: ${t(`language.${active}`)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-[11px] font-semibold text-ink-muted hover:text-ink-secondary hover:bg-dark-hover transition-colors"
      >
        {SHORT_LABEL[active]}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute start-full bottom-0 ms-2 w-40 rounded-lg bg-dark-panel border border-dark-border shadow-lg z-50 overflow-hidden"
        >
          {SUPPORTED_LANGUAGES.map((lng) => (
            <button
              key={lng}
              type="button"
              role="menuitem"
              // Each name is written in its own language, so someone who cannot
              // read the current UI can still find their own line.
              lang={lng}
              onClick={() => {
                void changeLanguage(lng);
                setOpen(false);
              }}
              className={`w-full text-start px-3 py-2 text-xs transition-colors hover:bg-dark-hover ${
                lng === active ? 'text-primary-400' : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              {t(`language.${lng}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
