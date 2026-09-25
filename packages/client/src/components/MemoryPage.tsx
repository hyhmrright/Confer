import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortDateTime } from '../lib/format-date.js';
import { INPUT_CLS } from '../lib/styles.js';
import { useMemoriesStore } from '../stores/memories.js';
import { EmptyState } from './EmptyState.js';
import { Trash } from './Icons.js';
import { LoadingDots } from './LoadingDots.js';
import { PanelForm } from './PanelForm.js';
import { PanelHeader } from './PanelHeader.js';
import { SearchField } from './SearchField.js';

export function MemoryPage() {
  const { t } = useTranslation();
  const memories = useMemoriesStore((s) => s.memories);
  const loading = useMemoriesStore((s) => s.loading);
  const loadMemories = useMemoriesStore((s) => s.loadMemories);
  const createMemory = useMemoriesStore((s) => s.createMemory);
  const updateMemory = useMemoriesStore((s) => s.updateMemory);
  const deleteMemory = useMemoriesStore((s) => s.deleteMemory);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const filtered = memories.filter(
    (m) =>
      m.title.toLowerCase().includes(query.toLowerCase()) ||
      m.content.toLowerCase().includes(query.toLowerCase()),
  );

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await createMemory(newTitle.trim(), newContent.trim());
      setNewTitle('');
      setNewContent('');
      setShowForm(false);
    } catch (err) {
      // The server refuses a memory it cannot index, because an unindexed one
      // is invisible to recall. Say which of the two it is — an unhandled
      // rejection here left the form open with no explanation at all.
      //
      // Read the code off the error rather than testing `instanceof ApiError`:
      // no component imports that class today, and the first one to do so has
      // to be declared by every test that mock.module's the api (the mock is
      // process-global, so one omission breaks unrelated files).
      const code = (err as { code?: unknown })?.code;
      setSaveError(
        code === 'embedding_unavailable' ? t('memory.noEmbedding') : t('memory.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader
        title={t('memory.title')}
        actionLabel={t('common.new')}
        onAction={() => setShowForm((v) => !v)}
      />
      <SearchField
        name="memory-search"
        value={query}
        onChange={setQuery}
        placeholder={t('memory.searchPlaceholder')}
      />

      {/* New memory form */}
      {showForm && (
        <PanelForm
          error={saveError}
          onCancel={() => {
            setShowForm(false);
            setSaveError(null);
          }}
          onSubmit={handleCreate}
          submitDisabled={saving || !newTitle.trim() || !newContent.trim()}
          submitLabel={saving ? t('common.saving') : t('common.save')}
        >
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={t('memory.titlePlaceholder')}
            className={INPUT_CLS}
          />
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={t('memory.contentPlaceholder')}
            rows={3}
            className={`${INPUT_CLS} resize-none`}
          />
        </PanelForm>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-8">
            <LoadingDots />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title={t('memory.empty')} hint={t('memory.emptyHint')} />
        ) : (
          filtered.map((mem) => (
            <div
              key={mem.id}
              className={`rounded-xl border p-3 group transition-colors
                ${
                  mem.pinned
                    ? 'border-primary-600/25 bg-primary-600/8'
                    : 'border-dark-border bg-dark-card hover:border-dark-border/80'
                }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {mem.pinned && (
                      <span className="text-[10px] font-medium text-primary-400 bg-primary-600/15 px-1.5 py-0.5 rounded-sm border border-primary-600/20 shrink-0">
                        {t('memory.pinned')}
                      </span>
                    )}
                    {mem.source === 'auto' && (
                      <span
                        className="text-[10px] font-medium text-ink-muted bg-dark-border px-1.5 py-0.5 rounded-sm shrink-0"
                        title={t('memory.autoTitle')}
                      >
                        {t('memory.auto')}
                      </span>
                    )}
                    {/* Warmer than the 'auto' chip on purpose: this one came in
                        over A2A, so it is the one worth a second look. */}
                    {mem.source === 'a2a' && (
                      <span
                        className="text-[10px] font-medium text-amber-300/90 bg-amber-400/10 px-1.5 py-0.5 rounded-sm border border-amber-400/20 shrink-0"
                        title={t('memory.a2aTitle')}
                      >
                        {t('memory.a2a')}
                      </span>
                    )}
                    <h3 className="text-xs font-semibold text-ink-primary truncate">{mem.title}</h3>
                  </div>
                  <p className="text-[11px] text-ink-secondary mt-1 leading-relaxed whitespace-pre-wrap line-clamp-3">
                    {mem.content}
                  </p>
                  {mem.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {mem.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] text-ink-muted bg-dark-border px-1.5 py-0.5 rounded-sm font-mono"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="eyebrow text-ink-muted mt-1.5">
                    {formatShortDateTime(mem.updated_at)}
                  </p>
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={() => updateMemory(mem.id, { pinned: !mem.pinned })}
                    className={`p-1 rounded transition-colors
                      ${
                        mem.pinned
                          ? 'text-primary-400 hover:text-primary-300'
                          : 'text-ink-muted hover:text-primary-400'
                      }`}
                    title={mem.pinned ? t('memory.unpin') : t('memory.pin')}
                  >
                    <svg
                      aria-hidden="true"
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill={mem.pinned ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M12 2L8 8H2l5 4-2 9 7-4 7 4-2-9 5-4h-6z" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMemory(mem.id)}
                    className="p-1 rounded-sm text-ink-muted hover:text-red-400 hover:bg-red-900/20 transition-colors"
                    title={t('memory.delete')}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
