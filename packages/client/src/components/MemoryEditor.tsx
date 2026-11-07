import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { INPUT_FIELD_CLS } from '../lib/styles.js';
import { useMemoriesStore } from '../stores/memories.js';

export function MemoryEditor({ id, content }: { id: string; content: string }) {
  const { t } = useTranslation();
  const update = useMemoriesStore((s) => s.updateMemory);
  const [value, setValue] = useState(content);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div className="text-xs mt-2">
      <button
        type="button"
        onClick={() => {
          setValue(content);
          setOpen((v) => !v);
        }}
      >
        {t('features.correctMemory')}
      </button>
      {open && (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(false);
            try {
              await update(id, { content: value });
              setOpen(false);
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <textarea
            aria-label={t('features.correctMemory')}
            className={INPUT_FIELD_CLS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
            maxLength={200000}
          />
          <button type="submit" disabled={busy || !value.trim()}>
            {t('common.save')}
          </button>
          {error && <p role="alert">{t('features.failed')}</p>}
        </form>
      )}
    </div>
  );
}
