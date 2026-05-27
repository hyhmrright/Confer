import { useState } from 'react';
import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';

export default function ConversationList() {
  const { conversations, activeConversationId, selectConversation, createConversation, deleteConversation } =
    useChatStore();
  const { openDialog } = useContactsStore();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleNew = async () => {
    const id = await createConversation();
    await selectConversation(id);
  };

  return (
    <aside className="w-72 border-r border-gray-200 bg-white flex flex-col">
      <div className="p-3 border-b border-gray-100 space-y-2">
        <button
          onClick={handleNew}
          className="w-full py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700"
        >
          新对话
        </button>
        <button
          onClick={openDialog}
          className="w-full py-2 text-sm border border-gray-300 text-gray-600 rounded-md hover:bg-gray-50"
        >
          添加联系人
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-sm text-gray-400 p-4 text-center">暂无对话</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            className={`relative border-b border-gray-50 ${conv.id === activeConversationId ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
            onMouseEnter={() => setHoveredId(conv.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <button
              onClick={() => selectConversation(conv.id)}
              className="w-full text-left px-4 py-3 pr-10"
            >
              <div className="text-sm font-medium truncate">
                {conv.name ?? `对话 ${conv.id.slice(0, 8)}`}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {new Date(conv.updated_at).toLocaleString('zh-CN')}
              </div>
            </button>
            {hoveredId === conv.id && (
              <button
                onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="删除对话"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
