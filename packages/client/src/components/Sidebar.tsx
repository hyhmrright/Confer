import { useTranslation } from 'react-i18next';
import { FOCUS_RING } from '../lib/styles.js';
import { useContactsStore } from '../stores/contacts.js';
import type { Tab } from './ChatLayout.js';
import { ContactList } from './ContactList.js';
import { ConversationsPanel } from './ConversationsPanel.js';
import { LogOut } from './Icons.js';
import { KnowledgePage } from './KnowledgePage.js';
import { MemoryPage } from './MemoryPage.js';
import { PanelHeader } from './PanelHeader.js';

/* ── Contacts panel ── */
function ContactsPanel() {
  const { t } = useTranslation();
  const openDialog = useContactsStore((s) => s.openDialog);
  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader
        title={t('contacts.title')}
        actionLabel={t('contacts.add')}
        onAction={openDialog}
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ContactList />
      </div>
    </div>
  );
}

/* ── Root sidebar ── */
export function Sidebar({
  tab,
  onLogout,
  onNavigate,
}: {
  tab: Tab;
  onLogout: () => void;
  /** Called when a panel selection should dismiss the narrow-viewport drawer. */
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    // Full width inside the drawer below md, back to its fixed column above it.
    <aside className="w-[calc(100vw-52px)] max-w-[320px] md:w-[260px] shrink-0 flex flex-col bg-dark-panel border-r border-dark-border overflow-hidden">
      {/* Page-as-Panel: MemoryPage / KnowledgePage are full-height list views
          authored to fit this 260px sidebar column (they own their own header +
          scroll area), so they render here as sidebar panels rather than routed
          pages. The "Page" suffix is historical — treat them as panels here. */}
      {tab === 'conversations' ? (
        <ConversationsPanel onNavigate={onNavigate} />
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
          className={`flex items-center gap-2 text-xs text-ink-muted hover:text-red-400 transition-colors rounded ${FOCUS_RING}`}
        >
          <LogOut className="w-3.5 h-3.5" />
          {t('nav.logout')}
        </button>
      </div>
    </aside>
  );
}
