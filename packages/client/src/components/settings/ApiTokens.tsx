import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';
import { formatShortDateTime } from '../../lib/format-date.js';
import {
  DISABLED_FILLED,
  FOCUS_RING,
  INPUT_FIELD_CLS,
  SELECT_FIELD_CLS,
} from '../../lib/styles.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

const EXPIRY_DAYS = [30, 90, 365] as const;

// Personal API tokens: create one per script, see it once, revoke at will.
export function ApiTokens() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ tokens: ApiToken[] }>('/tokens')
      .then((data) => setTokens(data.tokens))
      .catch(() => setError(t('security.failed')));

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api.post<{ token: ApiToken & { token: string } }>('/tokens', {
        name,
        ...(expiry ? { expires_in_days: Number(expiry) } : {}),
      });
      setFresh(data.token.token);
      setCopied(false);
      setName('');
      await load();
    } catch {
      setError(t('security.failed'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await api.delete(`/tokens/${id}`);
      setTokens((list) => list.filter((tok) => tok.id !== id));
    } catch {
      setError(t('security.failed'));
    }
  };

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-ink-primary">{t('apiTokens.heading')}</h3>
      <p className="text-xs text-ink-secondary">{t('apiTokens.hint')}</p>

      {fresh && (
        <div className="space-y-2 p-3 rounded-lg border border-primary-600/40 bg-primary-600/10">
          <p className="text-xs text-ink-primary">{t('apiTokens.createdHint')}</p>
          <code className="block text-xs font-mono text-ink-primary break-all select-all">
            {fresh}
          </code>
          <button
            type="button"
            onClick={() =>
              navigator.clipboard
                .writeText(fresh)
                .then(() => setCopied(true))
                .catch(() => {})
            }
            className={`px-3 py-1 rounded-lg border border-dark-border text-xs text-ink-secondary hover:bg-dark-hover ${FOCUS_RING}`}
          >
            {copied ? t('apiTokens.copied') : t('apiTokens.copy')}
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="text-xs text-ink-muted">{t('apiTokens.none')}</p>
      ) : (
        <ul className="space-y-2">
          {tokens.map((tok) => (
            <li
              key={tok.id}
              className="flex items-center gap-3 px-3 py-2 bg-dark-input border border-dark-border rounded-lg"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-primary truncate">{tok.name}</p>
                <p className="text-[11px] text-ink-muted font-mono">
                  {tok.prefix}… ·{' '}
                  {tok.last_used_at
                    ? t('apiTokens.lastUsed', { when: formatShortDateTime(tok.last_used_at) })
                    : t('apiTokens.neverUsed')}
                  {tok.expires_at &&
                    ` · ${t('apiTokens.expires', { when: formatShortDateTime(tok.expires_at) })}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(tok.id)}
                className={`shrink-0 px-2 py-1 rounded text-xs text-ink-muted hover:text-red-400 hover:bg-dark-hover ${FOCUS_RING}`}
              >
                {t('apiTokens.revoke')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-40">
          <FieldLabel htmlFor="api-token-name">{t('apiTokens.name')}</FieldLabel>
          <input
            id="api-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            className={INPUT_FIELD_CLS}
            required
          />
        </div>
        <div className="w-36">
          <FieldLabel htmlFor="api-token-expiry">{t('apiTokens.expiry')}</FieldLabel>
          <select
            id="api-token-expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={SELECT_FIELD_CLS}
          >
            <option value="">{t('apiTokens.never')}</option>
            {EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('apiTokens.days', { count: d })}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className={`px-3 py-2 rounded-lg bg-primary-600 text-white text-xs hover:bg-primary-500 ${DISABLED_FILLED} ${FOCUS_RING}`}
        >
          {t('apiTokens.create')}
        </button>
      </form>
      <StatusMsg error={error} success={null} />
    </section>
  );
}
