import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { usePermissionsStore } from '../stores/permissions.js';
import { connectWs, disconnectWs, onWsMessage } from '../lib/ws.js';
import { Settings, LogOut } from './Icons.js';
import Sidebar from './Sidebar.js';
import MessageView from './MessageView.js';
import AddContactDialog from './AddContactDialog.js';

export default function ChatLayout() {
  const { user, logout } = useAuthStore();
  const { loadConversations, activeConversationId, addMessage, setAgentStatus } = useChatStore();
  const { addRequest: addPermissionRequest, loadPending } = usePermissionsStore();
  const navigate = useNavigate();

  useEffect(() => {
    loadConversations();
    loadPending();
    connectWs();

    const unsubs = [
      onWsMessage('message.new', (data) => {
        const msg = data as {
          id: string;
          conversation_id: string;
          sender_type: string;
          sender_id: string;
          content: string;
          content_type: string;
          citations?: Array<{ source: string; url?: string; page?: number; passage?: string; trust_level?: string }>;
          in_reply_to?: string;
          content_json?: unknown;
        };
        addMessage({
          id: msg.id,
          conversation_id: msg.conversation_id,
          sender_type: msg.sender_type,
          sender_id: msg.sender_id,
          content: msg.content,
          content_type: msg.content_type ?? 'text',
          citations: msg.citations,
          created_at: new Date().toISOString(),
          in_reply_to: msg.in_reply_to,
          content_json: msg.content_json,
        });
      }),

      onWsMessage('permission.request', (data) => {
        const req = data as {
          id: string;
          level: string;
          action: string;
          scope: Record<string, unknown>;
          description: string;
          requested_at: string;
        };
        addPermissionRequest(req);
      }),

      onWsMessage('agent.status', (data) => {
        const status = data as { message?: string };
        setAgentStatus(status.message ?? null);
      }),
    ];

    return () => {
      disconnectWs();
      unsubs.forEach((fn) => fn());
    };
  }, [loadConversations, addMessage, addPermissionRequest, setAgentStatus, loadPending]);

  const handleLogout = () => {
    disconnectWs();
    logout();
  };

  const initials = (user?.display_name ?? user?.username ?? '?').charAt(0).toUpperCase();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">C</span>
          </div>
          <h1 className="font-semibold text-lg text-gray-800">Confer</h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="设置"
          >
            <Settings className="w-4.5 h-4.5" />
          </button>

          <div className="h-5 w-px bg-gray-200 mx-1" />

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center">
              <span className="text-xs font-medium text-primary-700">{initials}</span>
            </div>
            <span className="text-sm text-gray-600 hidden sm:inline">
              {user?.display_name ?? user?.username}
            </span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {activeConversationId ? (
          <MessageView />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-lg font-medium text-gray-400">选择或创建一个对话</p>
            <p className="text-sm text-gray-300 mt-1">从左侧选择对话，或点击"新对话"开始</p>
          </div>
        )}
      </div>

      <AddContactDialog />
    </div>
  );
}
