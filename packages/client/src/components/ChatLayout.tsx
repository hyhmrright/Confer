import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { permissionRequestSchema } from '../lib/schemas.js';
import { connectWs, disconnectWs, onWsMessage } from '../lib/ws.js';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { usePermissionsStore } from '../stores/permissions.js';
import { AddContactDialog } from './AddContactDialog.js';
import { BookOpen, Database, MessageCircle, Settings, Users } from './Icons.js';
import { MessageView } from './MessageView.js';
import { Sidebar } from './Sidebar.js';

export type Tab = 'conversations' | 'contacts' | 'memory' | 'knowledge';

const wsCitationSchema = z.object({
  source: z.string(),
  url: z.string().optional(),
  page: z.number().optional(),
  passage: z.string().optional(),
  trust_level: z.string().optional(),
});

const wsMessageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  sender_type: z.string(),
  sender_id: z.string(),
  content: z.string().nullable(),
  content_type: z.string().default('text'),
  citations: z.array(wsCitationSchema).optional(),
  in_reply_to: z.string().optional(),
  content_json: z.unknown().optional(),
});

const wsAgentStatusSchema = z.object({
  message: z.string().optional(),
});

const NAV_ITEMS = [
  { id: 'conversations' as Tab, Icon: MessageCircle, label: '对话' },
  { id: 'contacts' as Tab, Icon: Users, label: '联系人' },
  { id: 'memory' as Tab, Icon: BookOpen, label: '记忆' },
  { id: 'knowledge' as Tab, Icon: Database, label: '知识库' },
];

function NavRail({
  tab,
  setTab,
  initials,
  onSettings,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  initials: string;
  onSettings: () => void;
}) {
  return (
    <nav className="w-[52px] shrink-0 flex flex-col items-center py-3 gap-0.5 bg-dark-nav border-r border-dark-border">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center mb-4 shadow-lg shadow-primary-900/60">
        <span className="text-white text-xs font-bold font-mono tracking-wider">C</span>
      </div>

      {/* Navigation */}
      {NAV_ITEMS.map(({ id, Icon, label }) => {
        const active = tab === id;
        return (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 group
              ${
                active
                  ? 'bg-primary-600/15 text-primary-400'
                  : 'text-ink-muted hover:text-ink-secondary hover:bg-dark-hover'
              }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary-500 rounded-r-full" />
            )}
            <Icon className="w-[18px] h-[18px]" />
          </button>
        );
      })}

      <div className="flex-1" />

      {/* Settings */}
      <button
        type="button"
        onClick={onSettings}
        title="设置"
        className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-secondary hover:bg-dark-hover transition-colors"
      >
        <Settings className="w-[18px] h-[18px]" />
      </button>

      {/* Avatar / logout */}
      <button
        type="button"
        title="账号"
        className="w-7 h-7 mt-1 rounded-full bg-primary-600/20 border border-primary-600/30 flex items-center justify-center hover:bg-primary-600/30 transition-colors"
      >
        <span className="text-[11px] font-semibold text-primary-400 font-mono">{initials}</span>
      </button>
    </nav>
  );
}

export function ChatLayout() {
  const [tab, setTab] = useState<Tab>('conversations');
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
        const parsed = wsMessageSchema.safeParse(data);
        if (!parsed.success) {
          console.warn('[ws] message.new validation failed:', parsed.error.issues);
          return;
        }
        addMessage({ ...parsed.data, created_at: new Date().toISOString() });
      }),

      onWsMessage('permission.request', (data) => {
        const parsed = permissionRequestSchema.safeParse(data);
        if (!parsed.success) {
          console.warn('[ws] permission.request validation failed:', parsed.error.issues);
          return;
        }
        addPermissionRequest(parsed.data);
      }),

      onWsMessage('agent.status', (data) => {
        const parsed = wsAgentStatusSchema.safeParse(data);
        if (!parsed.success) {
          console.warn('[ws] agent.status validation failed:', parsed.error.issues);
          return;
        }
        setAgentStatus(parsed.data.message ?? null);
      }),
    ];

    return () => {
      disconnectWs();
      for (const fn of unsubs) fn();
    };
  }, [loadConversations, addMessage, addPermissionRequest, setAgentStatus, loadPending]);

  const initials = (user?.display_name ?? user?.username ?? '?').charAt(0).toUpperCase();

  return (
    <div className="h-screen flex bg-dark-base text-ink-primary overflow-hidden">
      <NavRail
        tab={tab}
        setTab={setTab}
        initials={initials}
        onSettings={() => navigate('/settings')}
      />

      <Sidebar
        tab={tab}
        onLogout={() => {
          disconnectWs();
          logout();
        }}
      />

      {activeConversationId ? (
        <MessageView />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-muted">
          <div className="w-14 h-14 rounded-2xl bg-dark-card border border-dark-border flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-ink-muted opacity-50" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-ink-secondary">选择或创建一个对话</p>
            <p className="text-xs text-ink-muted mt-0.5">从左侧点击对话，或新建一个</p>
          </div>
        </div>
      )}

      <AddContactDialog />
    </div>
  );
}
