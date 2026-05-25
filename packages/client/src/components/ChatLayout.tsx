import { useEffect } from 'react';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { connectWs, disconnectWs, onWsMessage } from '../lib/ws.js';
import ConversationList from './ConversationList.js';
import MessageView from './MessageView.js';
import AddContactDialog from './AddContactDialog.js';

export default function ChatLayout() {
  const { user, logout } = useAuthStore();
  const { loadConversations, activeConversationId, addMessage } = useChatStore();

  useEffect(() => {
    loadConversations();
    connectWs();

    const unsubNew = onWsMessage('message.new', (data) => {
      const msg = data as {
        id: string;
        conversation_id: string;
        sender_type: string;
        sender_id: string;
        content: string;
        in_reply_to?: string;
      };
      addMessage({
        id: msg.id,
        conversation_id: msg.conversation_id,
        sender_type: msg.sender_type,
        sender_id: msg.sender_id,
        content: msg.content,
        content_type: 'text',
        created_at: new Date().toISOString(),
        in_reply_to: msg.in_reply_to,
      });
    });

    return () => {
      disconnectWs();
      unsubNew();
    };
  }, [loadConversations, addMessage]);

  const handleLogout = () => {
    disconnectWs();
    logout();
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <h1 className="font-semibold text-lg">Confer</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">{user?.display_name ?? user?.username}</span>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-600">
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

      <AddContactDialog />
    </div>
  );
}
