import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../../i18n/index.js';
import { api } from '../../lib/api.js';
import { captureError } from '../../lib/error.js';
import { LLM_PROVIDERS } from '../../lib/providers.js';
import { DISABLED, FOCUS_RING } from '../../lib/styles.js';
import {
  currentMonth,
  shiftMonth,
  summarizeUsage,
  type UsageRow,
  type UsageSummary,
} from '../../lib/usage-summary.js';
import { ChevronRight } from '../Icons.js';

const NAV_BTN_CLS = `p-1.5 rounded-lg text-ink-secondary hover:bg-dark-hover hover:text-ink-primary ${FOCUS_RING} ${DISABLED}`;

function providerLabel(id: string): string {
  return LLM_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 bg-dark-card border border-dark-border rounded-lg">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="text-lg text-ink-primary font-medium tabular-nums">{value}</div>
    </div>
  );
}

export function UsageTab() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A month left before its answer arrived must not overwrite the one now shown.
    let current = true;
    setSummary(null);
    setError(null);
    api
      .get<{ rows: UsageRow[] }>(`/usage?month=${month}`)
      .then((data) => current && setSummary(summarizeUsage(data.rows)))
      .catch((e) => current && setError(captureError(e, t('usage.loadError'))));
    return () => {
      current = false;
    };
  }, [month, t]);

  const locale = dateLocale();
  const num = new Intl.NumberFormat(locale);
  const tokens = (value: number | null) => (value === null ? '—' : num.format(value));
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          aria-label={t('usage.prevMonth')}
          className={NAV_BTN_CLS}
        >
          <ChevronRight className="w-4 h-4 rotate-180 rtl:rotate-0" />
        </button>
        <h3 className="text-sm font-medium text-ink-primary" aria-live="polite">
          {monthLabel}
        </h3>
        <button
          type="button"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          disabled={month >= currentMonth()}
          aria-label={t('usage.nextMonth')}
          className={NAV_BTN_CLS}
        >
          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-400 text-center py-8">
          {error}
        </p>
      )}

      {summary && summary.turns === 0 && (
        <p className="text-sm text-ink-muted text-center py-8">{t('usage.empty')}</p>
      )}

      {summary && summary.turns > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Stat label={t('usage.turns')} value={num.format(summary.turns)} />
            <Stat label={t('usage.inputTokens')} value={num.format(summary.inputTokens)} />
            <Stat label={t('usage.outputTokens')} value={num.format(summary.outputTokens)} />
            {summary.cacheHitRate !== null && (
              <Stat
                label={t('usage.cacheRead')}
                value={new Intl.NumberFormat(locale, { style: 'percent' }).format(
                  summary.cacheHitRate,
                )}
              />
            )}
          </div>

          <ul className="space-y-1 text-xs text-ink-secondary">
            {summary.peerTurns > 0 && <li>{t('usage.peerTurns', { count: summary.peerTurns })}</li>}
            {summary.failed > 0 && <li>{t('usage.failed', { count: summary.failed })}</li>}
            {summary.unreported > 0 && (
              <li className="text-amber-400">
                {t('usage.unreported', { count: summary.unreported })}
              </li>
            )}
          </ul>

          <table className="w-full text-xs">
            <caption className="text-start text-xs font-medium text-ink-secondary mb-1.5">
              {t('usage.byModel')}
            </caption>
            <thead className="text-ink-muted">
              <tr className="border-b border-dark-border">
                <th scope="col" className="text-start font-normal py-1.5">
                  {t('usage.model')}
                </th>
                <th scope="col" className="text-end font-normal py-1.5">
                  {t('usage.turns')}
                </th>
                <th scope="col" className="text-end font-normal py-1.5">
                  {t('usage.inputTokens')}
                </th>
                <th scope="col" className="text-end font-normal py-1.5">
                  {t('usage.outputTokens')}
                </th>
              </tr>
            </thead>
            <tbody className="text-ink-primary tabular-nums">
              {summary.byModel.map((line) => (
                <tr
                  key={`${line.provider}/${line.model ?? ''}`}
                  className="border-b border-dark-border/50"
                >
                  <th scope="row" className="text-start font-normal py-1.5 pe-2">
                    <span className="text-ink-secondary">{providerLabel(line.provider)}</span>{' '}
                    <span className="font-mono break-all">
                      {line.model ?? t('usage.defaultModel')}
                    </span>
                  </th>
                  <td className="text-end py-1.5">{num.format(line.turns)}</td>
                  <td className="text-end py-1.5">{tokens(line.inputTokens)}</td>
                  <td className="text-end py-1.5">{tokens(line.outputTokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="text-[11px] text-ink-muted">{t('usage.note')}</p>
    </div>
  );
}
