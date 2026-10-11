import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortDateTime } from '../lib/format-date.js';
import { FOCUS_RING } from '../lib/styles.js';
import { useChatStore } from '../stores/chat.js';
import { Archive, Bot, Pencil, Trash } from './Icons.js';
import { PanelHeader } from './PanelHeader.js';
import { SearchField } from './SearchField.js';

type Conversation = ReturnType<typeof useChatStore.getState>['conversations'][number];

const ROW_ACTION = `p-1 rounded text-ink-muted transition-colors ${FOCUS_RING}`;

// `onNavigate` fires once a conversation becomes the active one. On a narrow
// viewport the panel is inside the drawer covering the messages, so picking a
// conversation has to dismiss it or the user never sees what they picked.
export function ConversationsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  // Per-field selectors: this panel is always mounted alongside the message
  // view, so subscribing to the whole chat store would re-render the entire
  // conversation list on every streamed token.
  const conversations = useChatStore((s) => s.conversations);
  const showArchived = useChatStore((s) => s.showArchived);
  const setShowArchived = useChatStore((s) => s.setShowArchived);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createConversation = useChatStore((s) => s.createConversation);

  const filtered = conversations.filter((c) =>
    (c.name ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  const handleNew = async () => {
    if (showArchived) await setShowArchived(false);
    const id = await createConversation();
    await selectConversation(id);
    onNavigate?.();
  };

  const handleSelect = async (id: string) => {
    await selectConversation(id);
    onNavigate?.();
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PanelHeader
        title={showArchived ? t('conversations.showArchived') : t('conversations.title')}
        actionLabel={t('conversations.new')}
        onAction={handleNew}
      />
      <SearchField
        name="conversation-search"
        value={query}
        onChange={setQuery}
        placeholder={t('conversations.searchPlaceholder')}
      />

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-ink-muted">
            <p className="text-xs">
              {showArchived ? t('conversations.archivedEmpty') : t('conversations.empty')}
            </p>
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationRow
              key={conv.id}
              conv={conv}
              archived={showArchived}
              onSelect={() => handleSelect(conv.id)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowArchived(!showArchived)}
        className={`shrink-0 flex items-center gap-2 px-4 py-2.5 border-t border-dark-border eyebrow text-ink-muted hover:text-ink-secondary hover:bg-dark-hover ${FOCUS_RING}`}
      >
        <Archive className="w-3.5 h-3.5" />
        {showArchived ? t('conversations.showActive') : t('conversations.showArchived')}
      </button>
    </div>
  );
}

function ConversationRow({
  conv,
  archived,
  onSelect,
}: {
  conv: Conversation;
  archived: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const active = useChatStore((s) => s.activeConversationId === conv.id);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const setArchived = useChatStore((s) => s.setArchived);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const [hovered, setHovered] = useState(false);
  // The draft name while renaming; null when not.
  const [draft, setDraft] = useState<string | null>(null);

  const title = conv.name ?? t('conversations.untitled', { id: conv.id.slice(0, 6) });
  // The open thread is being read as it arrives, whatever the last list said.
  const unread = active ? 0 : (conv.unread_count ?? 0);

  const commitRename = () => {
    const name = draft?.trim();
    setDraft(null);
    if (name && name !== conv.name) void renameConversation(conv.id, name);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-only affordance; the real controls are the nested buttons, which already carry keyboard focus
    <div
      className={`relative group transition-colors duration-100
        ${active ? 'bg-dark-active' : 'hover:bg-dark-hover'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {active && (
        <span className="absolute start-0 top-1/2 -translate-y-1/2 w-[2px] h-7 bg-primary-500 rounded-e-full" />
      )}
      <div className="w-full flex items-center gap-3 px-4 py-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
          ${active ? 'bg-primary-600/20' : 'bg-dark-border'}`}
        >
          <Bot className={`w-[15px] h-[15px] ${active ? 'text-primary-400' : 'text-ink-muted'}`} />
        </div>
        {draft !== null ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: opened by an explicit Rename click, so focus is where the user asked for it
            autoFocus
            aria-label={t('conversations.renameLabel')}
            value={draft}
            maxLength={255}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setDraft(null);
            }}
            className="flex-1 min-w-0 bg-dark-input border border-dark-border rounded px-2 py-1 text-xs text-ink-primary focus:outline-hidden focus:border-primary-500"
          />
        ) : (
          <button
            type="button"
            onClick={onSelect}
            className="flex-1 min-w-0 text-start cursor-pointer after:absolute after:inset-0"
          >
            <p
              className={`text-xs font-medium truncate transition-colors
              ${active || unread > 0 ? 'text-ink-primary' : 'text-ink-secondary'}`}
            >
              {title}
            </p>
            <p className="eyebrow text-ink-muted mt-0.5">{formatShortDateTime(conv.updated_at)}</p>
          </button>
        )}
        {unread > 0 && !hovered && draft === null && (
          <span
            role="status"
            aria-label={t('conversations.unread', { count: unread })}
            className="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary-600 text-white text-[10px] font-medium flex items-center justify-center"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
      {hovered && draft === null && (
        <div className="absolute end-2.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-dark-hover rounded">
          <button
            type="button"
            onClick={() => setDraft(conv.name ?? '')}
            className={`${ROW_ACTION} hover:text-ink-primary`}
            title={t('conversations.rename')}
            aria-label={t('conversations.rename')}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setArchived(conv.id, !archived)}
            className={`${ROW_ACTION} hover:text-ink-primary`}
            title={archived ? t('conversations.unarchive') : t('conversations.archive')}
            aria-label={archived ? t('conversations.unarchive') : t('conversations.archive')}
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => deleteConversation(conv.id)}
            className={`${ROW_ACTION} hover:text-red-400 hover:bg-red-900/20`}
            title={t('conversations.delete')}
            aria-label={t('conversations.delete')}
          >
            <Trash className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
