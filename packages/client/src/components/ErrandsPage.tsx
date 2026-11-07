import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TranslationKey } from '../i18n/index.js';
import { api } from '../lib/api.js';
import { INPUT_FIELD_CLS } from '../lib/styles.js';
import type { ErrandCard as Card } from '../stores/errands.js';
import { ErrandCard } from './ErrandCard.js';

interface Errand {
  id: string;
  title: string;
  status: string;
}
interface Event {
  id: string;
  status: string;
  note: string;
  created_at: string;
}
const labels: Record<string, TranslationKey> = {
  in_progress: 'features.running',
  waiting_peer: 'features.waitingPeer',
  waiting_input: 'features.waitingInput',
  human_control: 'features.humanControl',
  completed: 'features.completed',
  cancelled: 'features.cancelled',
};
export function ErrandsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Errand[]>([]);
  const [id, setId] = useState('');
  const [detail, setDetail] = useState<{ errand: Errand; events: Event[]; cards: Card[] } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const updating = useRef(false);
  const detailRequest = useRef(0);
  const load = useCallback(async () => {
    const result = await api.get<{ errands: Errand[] }>('/errands');
    setRows(result.errands);
  }, []);
  useEffect(() => {
    void load().catch(() => setError(true));
  }, [load]);
  useEffect(() => {
    setDetail(null);
    setNote('');
    detailRequest.current++;
    if (!id) return;
    let current = true;
    const refresh = () => {
      const ticket = ++detailRequest.current;
      if (!document.hidden && !updating.current)
        void api
          .get<typeof detail>(`/errands/${id}`)
          .then((d) => {
            if (current && ticket === detailRequest.current) setDetail(d);
          })
          .catch(() => {
            if (current && ticket === detailRequest.current) setError(true);
          });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [id]);
  const update = async (status: string) => {
    setBusy(true);
    updating.current = true;
    detailRequest.current++;
    setError(false);
    try {
      await api.post(`/errands/${id}/progress`, { status, note });
      setNote('');
      setDetail(await api.get(`/errands/${id}`));
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      updating.current = false;
    }
  };
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5 text-ink-primary">
      <Link to="/">{t('features.back')}</Link>
      <h1 className="text-xl">{t('features.tasks')}</h1>
      <p className="text-xs text-ink-secondary">{t('features.taskHint')}</p>
      <select
        aria-label={t('features.tasks')}
        className={INPUT_FIELD_CLS}
        disabled={busy}
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        <option value="">—</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.title}
          </option>
        ))}
      </select>
      {detail && (
        <section className="space-y-4">
          <h2>
            {detail.errand.title} · {t(labels[detail.errand.status] ?? 'features.running')}
          </h2>
          {!['completed', 'cancelled'].includes(detail.errand.status) && (
            <>
              <label className="block text-sm">
                {t('features.note')}
                <textarea
                  maxLength={4000}
                  className={INPUT_FIELD_CLS}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="flex gap-4 flex-wrap">
                {(
                  [
                    'in_progress',
                    'waiting_peer',
                    'waiting_input',
                    'human_control',
                    'completed',
                    'cancelled',
                  ] as const
                ).map((status) => (
                  <button
                    key={status}
                    type="button"
                    disabled={busy}
                    className="border border-dark-border rounded-lg px-3 py-2 text-xs"
                    onClick={() => update(status)}
                  >
                    {t(labels[status] ?? 'features.running')}
                  </button>
                ))}
              </div>
            </>
          )}
          {detail.errand.status !== 'human_control' &&
            !['completed', 'cancelled'].includes(detail.errand.status) &&
            detail.cards
              .filter((c) => c.decision === undefined || c.decision === 'pending')
              .map((card) => (
                <ErrandCard key={card.id} card={{ ...card, errand_title: detail.errand.title }} />
              ))}
          <ol className="space-y-3">
            {detail.events.map((event) => (
              <li key={event.id} className="border-s-2 border-dark-border ps-4 text-sm">
                <p>
                  {t(labels[event.status] ?? 'features.running')} ·{' '}
                  {new Date(event.created_at).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap text-ink-secondary">{event.note}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {error && <p role="alert">{t('features.failed')}</p>}
    </main>
  );
}
