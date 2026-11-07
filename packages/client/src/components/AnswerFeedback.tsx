import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.js';
import { INPUT_FIELD_CLS } from '../lib/styles.js';

export function AnswerFeedback({ messageId }: { messageId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('incorrect_answer');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="text-xs mt-2 text-ink-muted">
      <button type="button" onClick={() => setOpen((v) => !v)}>
        {t('features.feedback')}
      </button>
      {open && (
        <form
          className="space-y-2 mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            try {
              await api.post('/feedback', { message_id: messageId, kind, note });
              setSaved(true);
              setNote('');
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <select
            aria-label={t('features.feedback')}
            className={INPUT_FIELD_CLS}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setSaved(false);
            }}
          >
            <option value="incorrect_answer">{t('features.incorrectAnswer')}</option>
            <option value="incorrect_memory">{t('features.incorrectMemory')}</option>
            <option value="outdated_source">{t('features.outdatedSource')}</option>
          </select>
          <textarea
            aria-label={t('features.note')}
            required
            maxLength={4000}
            className={INPUT_FIELD_CLS}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
          />
          <button type="submit" disabled={busy || !note.trim()}>
            {t('common.save')}
          </button>
          {saved && <p role="status">{t('features.feedbackSaved')}</p>}
          {error && <p role="alert">{t('features.failed')}</p>}
        </form>
      )}
    </div>
  );
}
