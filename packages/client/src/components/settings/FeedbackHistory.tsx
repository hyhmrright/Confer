import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.js';

export function FeedbackHistory() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ id: string; note: string; created_at: string }[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    void api
      .get<{ feedback: typeof rows }>('/feedback')
      .then((data) => {
        if (live) setRows(data.feedback);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="space-y-3">
      <h3>{t('features.feedback')}</h3>
      <p className="text-xs text-ink-secondary">{t('features.feedbackSaved')}</p>
      {error && <p role="alert">{t('features.failed')}</p>}
      {rows.map((row) => (
        <div className="text-xs border border-dark-border rounded-lg p-3" key={row.id}>
          <p className="whitespace-pre-wrap">{row.note}</p>
          <time>{new Date(row.created_at).toLocaleString()}</time>
        </div>
      ))}
    </section>
  );
}
