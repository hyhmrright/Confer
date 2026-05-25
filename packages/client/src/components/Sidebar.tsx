import { useState } from 'react';
import { useChatStore } from '../stores/chat.js';
import { useContactsStore } from '../stores/contacts.js';
import { MessageCircle, Users, Plus, Bot } from './Icons.js';
import ContactList from './ContactList.js';

type Tab = 'conversations' | 'contacts';

export default function Sidebar() {
  const [tab, setTab] = useState<Tab>('conversations');
  const {
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
  } = useChatStore();
  const { openDialog } = useContactsStore();

  const handleNewConversation = async () => {
    const id = await createConversation();
    await selectConversation(id);
  };

  return (
    <aside className="w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setTab('conversations')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
            tab === 'conversations'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          对话
        </button>
        <button
          onClick={() => setTab('contacts')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium transition-colors ${
            tab === 'contacts'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <Users className="w-4 h-4" />
          联系人
        </button>
      </div>

      {/* Action bar */}
      <div className="p-3 border-b border-gray-100">
        {tab === 'conversations' ? (
          <button
            onClick={handleNewConversation}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新对话
          </button>
        ) : (
          <button
            onClick={openDialog}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            添加联系人
          </button>
        )}
      </div>

      {/* Content */}
      {tab === 'conversations' ? (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6">
              <MessageCircle className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">暂无对话</p>
              <p className="text-xs mt-1">点击上方按钮开始</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => selectConversation(conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                  conv.id === activeConversationId ? 'bg-primary-50 border-l-2 border-l-primary-500' : ''
                }`}
              >
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <Bot className="w-4.5 h-4.5 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {conv.name ?? `对话 ${conv.id.slice(0, 8)}`}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {new Date(conv.updated_at).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <ContactList />
      )}
    </aside>
  );
}
