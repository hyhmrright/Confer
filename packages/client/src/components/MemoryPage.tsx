import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale } from '../i18n/index.js';
import { INPUT_CLS } from '../lib/styles.js';
import { useMemoriesStore } from '../stores/memories.js';
import { Plus, Search, Trash } from './Icons.js';

export function MemoryPage() {
  const { t } = useTranslation();
  const { memories, loading, loadMemories, createMemory, updateMemory, deleteMemory } =
    useMemoriesStore();
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);

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
    try {
      await createMemory(newTitle.trim(), newContent.trim());
      setNewTitle('');
      setNewContent('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border shrink-0">
        <span className="text-xs font-semibold text-ink-secondary tracking-wider uppercase font-mono">
          {t('memory.title')}
        </span>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md
            bg-primary-600/15 text-primary-400 border border-primary-600/20
            hover:bg-primary-600/25 transition-all"
        >
          <Plus className="w-3 h-3" />
          {t('common.new')}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-dark-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
          <input
            name="memory-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('memory.searchPlaceholder')}
            className="w-full pl-8 pr-3 py-1.5 bg-dark-input border border-dark-border text-ink-secondary
              text-xs rounded-md placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors"
          />
        </div>
      </div>

      {/* New memory form */}
      {showForm && (
        <div className="px-3 py-3 border-b border-dark-border space-y-2 shrink-0 bg-dark-card/50">
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
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs text-ink-muted hover:text-ink-secondary transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving || !newTitle.trim() || !newContent.trim()}
              className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg
                hover:bg-primary-500 disabled:opacity-40 transition-colors"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-2">
        {loading ? (
          <div className="flex justify-center pt-8">
            <div className="flex gap-1.5">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="w-1.5 h-1.5 rounded-full bg-dark-border animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-ink-muted pt-10">
            <p className="text-xs">{t('memory.empty')}</p>
            <p className="text-[10px] mt-0.5 text-ink-muted opacity-60">{t('memory.emptyHint')}</p>
          </div>
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
                      <span className="text-[10px] font-medium text-primary-400 bg-primary-600/15 px-1.5 py-0.5 rounded border border-primary-600/20 shrink-0">
                        {t('memory.pinned')}
                      </span>
                    )}
                    {mem.source === 'auto' && (
                      <span
                        className="text-[10px] font-medium text-ink-muted bg-dark-border px-1.5 py-0.5 rounded shrink-0"
                        title={t('memory.autoTitle')}
                      >
                        {t('memory.auto')}
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
                          className="text-[10px] text-ink-muted bg-dark-border px-1.5 py-0.5 rounded font-mono"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-ink-muted mt-1.5 font-mono">
                    {new Date(mem.updated_at).toLocaleString(dateLocale(), {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
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
                    className="p-1 rounded text-ink-muted hover:text-red-400 hover:bg-red-900/20 transition-colors"
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
