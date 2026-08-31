import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DISABLED_FILLED, FOCUS_RING } from '../lib/styles.js';
import { useContactsStore } from '../stores/contacts.js';
import { Bot, Loader, Search } from './Icons.js';
import { Modal } from './Modal.js';

export function AddContactDialog() {
  const { t } = useTranslation();
  const dialogOpen = useContactsStore((s) => s.dialogOpen);
  const closeDialog = useContactsStore((s) => s.closeDialog);
  const lookupPeer = useContactsStore((s) => s.lookupPeer);
  const addContact = useContactsStore((s) => s.addContact);
  const loading = useContactsStore((s) => s.loading);
  const error = useContactsStore((s) => s.error);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<
    Array<{ id: string; did: string; name?: string; description?: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  if (!dialogOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    try {
      const candidates = await lookupPeer(query.trim());
      setResults(candidates);
    } catch {
      setResults([]);
    }
    setSearching(false);
  };

  const handleClose = () => {
    setQuery('');
    setResults([]);
    closeDialog();
  };

  return (
    <Modal title={t('contacts.dialogTitle')} onClose={handleClose}>
      {/* Search */}
      <div className="px-6 py-4">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              type="text"
              name="contact-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('contacts.lookupPlaceholder')}
              aria-label={t('contacts.lookupPlaceholder')}
              className={`w-full ps-9 pe-3 py-2.5 bg-dark-input border border-dark-border rounded-xl text-sm text-ink-primary placeholder:text-ink-muted ${FOCUS_RING} transition-colors`}
            />
          </div>
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className={`px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm hover:bg-primary-700 ${DISABLED_FILLED} transition-colors flex items-center gap-1.5 ${FOCUS_RING}`}
          >
            {/* `animate-spin` is spelled out because a caller's className
                replaces the icon's own — without it this spinner sits still. */}
            {searching ? (
              <Loader className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            {t('contacts.search')}
          </button>
        </form>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-6 mb-3 px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg"
        >
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Results */}
      <div className="px-6 pb-6">
        {results.length > 0 ? (
          <ul className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
            {results.map((agent) => (
              <li
                key={agent.id}
                className="flex items-center gap-3 p-3 border border-dark-border rounded-xl hover:border-dark-active transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-dark-border flex items-center justify-center shrink-0">
                  <Bot className="w-5 h-5 text-ink-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-primary">
                    {agent.name ?? t('contacts.unnamedAgent')}
                  </div>
                  <div className="text-xs text-ink-muted truncate">{agent.did}</div>
                  {agent.description && (
                    <div className="text-xs text-ink-muted truncate mt-0.5">
                      {agent.description}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => addContact(agent.id)}
                  disabled={loading}
                  className={`px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 ${DISABLED_FILLED} transition-colors shrink-0 ${FOCUS_RING}`}
                >
                  {t('contacts.add')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          query &&
          !searching &&
          !error && (
            <div role="status" className="text-center py-8">
              <Bot className="w-10 h-10 text-ink-muted mx-auto mb-2" />
              <p className="text-sm text-ink-muted">{t('contacts.notFound')}</p>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}
