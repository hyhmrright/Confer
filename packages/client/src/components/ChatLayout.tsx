import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import ConversationList from './ConversationList.js';
import MessageView from './MessageView.js';

export default function ChatLayout() {
  const { user, logout } = useAuthStore();
  const { loadConversations, activeConversationId } = useChatStore();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <h1 className="font-semibold text-lg">Confer</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user?.display_name ?? user?.username}</span>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600">
            退出
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <ConversationList />
        {activeConversationId ? (
          <MessageView />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            选择一个对话或创建新对话
          </div>
        )}
      </div>
    </div>
  );
}
