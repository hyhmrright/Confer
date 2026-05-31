import { useState } from 'react';
import { useChatStore } from '../stores/chat.js';
import { Bot, Plus, Search, Trash } from './Icons.js';

export function ConversationsPanel() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    deleteConversation,
  } = useChatStore();

  const filtered = conversations.filter((c) =>
    (c.name ?? '').toLowerCase().includes(query.toLowerCase()),
  );

  const handleNew = async () => {
    const id = await createConversation();
    await selectConversation(id);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border shrink-0">
        <span className="text-xs font-semibold text-ink-secondary tracking-wider uppercase font-mono">
          对话
        </span>
        <button
          type="button"
          onClick={handleNew}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md
            bg-primary-600/15 text-primary-400 border border-primary-600/20
            hover:bg-primary-600/25 hover:border-primary-600/35 transition-all"
        >
          <Plus className="w-3 h-3" />
          新对话
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-dark-border shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
          <input
            name="conversation-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索..."
            className="w-full pl-8 pr-3 py-1.5 bg-dark-input text-ink-secondary text-xs rounded-md
              border border-dark-border placeholder:text-ink-muted
              focus:outline-none focus:border-primary-600/40 transition-colors"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-ink-muted">
            <p className="text-xs">暂无对话</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const active = conv.id === activeConversationId;
            return (
              <div
                key={conv.id}
                className={`relative group transition-colors duration-100
                  ${active ? 'bg-dark-active' : 'hover:bg-dark-hover'}`}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-7 bg-primary-500 rounded-r-full" />
                )}
                <button
                  type="button"
                  onClick={() => selectConversation(conv.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
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
                      {conv.name ?? `对话 ${conv.id.slice(0, 6)}`}
                    </p>
                    <p className="text-[10px] text-ink-muted mt-0.5 font-mono">
                      {new Date(conv.updated_at).toLocaleString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </button>
                {hoveredId === conv.id && (
                  <button
                    type="button"
                    onClick={() => deleteConversation(conv.id)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded
                      text-ink-muted hover:text-red-400 hover:bg-red-900/20 transition-colors"
                    title="删除"
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
