import { useTranslation } from 'react-i18next';
import { useContactsStore } from '../stores/contacts.js';
import type { Tab } from './ChatLayout.js';
import { ContactList } from './ContactList.js';
import { ConversationsPanel } from './ConversationsPanel.js';
import { LogOut, Plus } from './Icons.js';
import { KnowledgePage } from './KnowledgePage.js';
import { MemoryPage } from './MemoryPage.js';

/* ── Contacts panel ── */
function ContactsPanel() {
  const { t } = useTranslation();
  const { openDialog } = useContactsStore();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border shrink-0">
        <span className="text-xs font-semibold text-ink-secondary tracking-wider uppercase font-mono">
          {t('contacts.title')}
        </span>
        <button
          type="button"
          onClick={openDialog}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md
            bg-primary-600/15 text-primary-400 border border-primary-600/20
            hover:bg-primary-600/25 hover:border-primary-600/35 transition-all"
        >
          <Plus className="w-3 h-3" />
          {t('contacts.add')}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ContactList />
      </div>
    </div>
  );
}

/* ── Root sidebar ── */
export function Sidebar({ tab, onLogout }: { tab: Tab; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <aside className="w-[260px] shrink-0 flex flex-col bg-dark-panel border-r border-dark-border overflow-hidden">
      {tab === 'conversations' ? (
        <ConversationsPanel />
      ) : tab === 'contacts' ? (
        <ContactsPanel />
      ) : tab === 'memory' ? (
        <MemoryPage />
      ) : (
        <KnowledgePage />
      )}

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-dark-border shrink-0">
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-2 text-xs text-ink-muted hover:text-red-400 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          {t('nav.logout')}
        </button>
      </div>
    </aside>
  );
}
