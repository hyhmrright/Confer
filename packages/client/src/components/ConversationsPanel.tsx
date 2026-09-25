import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatShortDateTime } from '../lib/format-date.js';
import { useChatStore } from '../stores/chat.js';
import { Bot, Trash } from './Icons.js';
import { PanelHeader } from './PanelHeader.js';
import { SearchField } from './SearchField.js';

// `onNavigate` fires once a conversation becomes the active one. On a narrow
// viewport the panel is inside the drawer covering the messages, so picking a
// conversation has to dismiss it or the user never sees what they picked.
export function ConversationsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Per-field selectors: this panel is always mounted alongside the message
  // view, so subscribing to the whole chat store would re-render the entire
  // conversation list on every streamed token.
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  const filtered = conversations.filter((c) =>
    (c.name ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  const handleNew = async () => {
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
        title={t('conversations.title')}
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
            <p className="text-xs">{t('conversations.empty')}</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const active = conv.id === activeConversationId;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover-only affordance; the real control is the nested <button>, which already carries keyboard focus
              <div
                key={conv.id}
                className={`relative group transition-colors duration-100
                  ${active ? 'bg-dark-active' : 'hover:bg-dark-hover'}`}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {active && (
                  <span className="absolute start-0 top-1/2 -translate-y-1/2 w-[2px] h-7 bg-primary-500 rounded-e-full" />
                )}
                <button
                  type="button"
                  onClick={() => handleSelect(conv.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-start cursor-pointer"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors
                    ${active ? 'bg-primary-600/20' : 'bg-dark-border'}`}
                  >
                    <Bot
                      className={`w-[15px] h-[15px] ${active ? 'text-primary-400' : 'text-ink-muted'}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-medium truncate transition-colors
                      ${active ? 'text-ink-primary' : 'text-ink-secondary'}`}
                    >
                      {conv.name ?? t('conversations.untitled', { id: conv.id.slice(0, 6) })}
                    </p>
                    <p className="eyebrow text-ink-muted mt-0.5">
                      {formatShortDateTime(conv.updated_at)}
                    </p>
                  </div>
                </button>
                {hoveredId === conv.id && (
                  <button
                    type="button"
                    onClick={() => deleteConversation(conv.id)}
                    className="absolute end-2.5 top-1/2 -translate-y-1/2 p-1 rounded
                      text-ink-muted hover:text-red-400 hover:bg-red-900/20 transition-colors"
                    title={t('conversations.delete')}
                  >
                    <Trash className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
