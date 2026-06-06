import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { TranslationKey } from '../i18n/index.js';
import { setOnTokenRefreshed } from '../lib/api.js';
import { permissionRequestSchema } from '../lib/schemas.js';
import { connectWs, disconnectWs, onWsMessage, reconnectWs } from '../lib/ws.js';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { usePermissionsStore } from '../stores/permissions.js';
import { AccountMenu, type AccountUser } from './AccountMenu.js';
import { AddContactDialog } from './AddContactDialog.js';
import { BookOpen, Database, MessageCircle, Settings, Shield, Users } from './Icons.js';
import { LanguageSwitcherCompact } from './LanguageSwitcher.js';
import { MessageView } from './MessageView.js';
import { PermissionInbox } from './PermissionInbox.js';
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
  { id: 'conversations' as Tab, Icon: MessageCircle, labelKey: 'nav.conversations' },
  { id: 'contacts' as Tab, Icon: Users, labelKey: 'nav.contacts' },
  { id: 'memory' as Tab, Icon: BookOpen, labelKey: 'nav.memory' },
  { id: 'knowledge' as Tab, Icon: Database, labelKey: 'nav.knowledge' },
] as const satisfies { id: Tab; Icon: typeof MessageCircle; labelKey: TranslationKey }[];

function NavRail({
  tab,
  setTab,
  initials,
  isAdmin,
  onAdmin,
  onSettings,
  user,
  onLogout,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  initials: string;
  isAdmin: boolean;
  onAdmin: () => void;
  onSettings: () => void;
  user: AccountUser | null;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  return (
    <nav className="w-[52px] shrink-0 flex flex-col items-center py-3 gap-0.5 bg-dark-nav border-r border-dark-border">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center mb-4 shadow-lg shadow-primary-900/60">
        <span className="text-white text-xs font-bold font-mono tracking-wider">C</span>
      </div>

      {/* Navigation */}
      {NAV_ITEMS.map(({ id, Icon, labelKey }) => {
        const active = tab === id;
        return (
          <button
            type="button"
            key={id}
            onClick={() => setTab(id)}
            title={t(labelKey)}
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

      {/* Language */}
      <LanguageSwitcherCompact />

      {/* Admin (admins only) */}
      {isAdmin && (
        <button
          type="button"
          onClick={onAdmin}
          title={t('nav.admin')}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-secondary hover:bg-dark-hover transition-colors"
        >
          <Shield className="w-[18px] h-[18px]" />
        </button>
      )}

      {/* Settings */}
      <button
        type="button"
        onClick={onSettings}
        title={t('nav.settings')}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-muted hover:text-ink-secondary hover:bg-dark-hover transition-colors"
      >
        <Settings className="w-[18px] h-[18px]" />
      </button>

      {/* Account menu */}
      <AccountMenu user={user} initials={initials} onLogout={onLogout} />
    </nav>
  );
}

export function ChatLayout() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('conversations');
  const { user, logout } = useAuthStore();
  const { loadConversations, activeConversationId, addMessage, setAgentStatus } = useChatStore();
  const { addRequest: addPermissionRequest, loadPending } = usePermissionsStore();
  const navigate = useNavigate();

  useEffect(() => {
    loadConversations();
    loadPending();
    connectWs();
    // A boot-time connection may use an expired stored token; reconnect with the
    // fresh one once the first API call triggers a refresh.
    setOnTokenRefreshed(reconnectWs);

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
      setOnTokenRefreshed(null);
      disconnectWs();
      for (const fn of unsubs) fn();
    };
  }, [loadConversations, addMessage, addPermissionRequest, setAgentStatus, loadPending]);

  const initials = (user?.display_name ?? user?.username ?? '?').charAt(0).toUpperCase();

  const handleLogout = () => {
    disconnectWs();
    logout();
  };

  return (
    <div className="h-screen flex bg-dark-base text-ink-primary overflow-hidden">
      <NavRail
        tab={tab}
        setTab={setTab}
        initials={initials}
        isAdmin={user?.role === 'admin'}
        onAdmin={() => navigate('/admin')}
        onSettings={() => navigate('/settings')}
        user={user}
        onLogout={handleLogout}
      />

      <Sidebar tab={tab} onLogout={handleLogout} />

      {activeConversationId ? (
        <MessageView />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-ink-muted">
          <div className="w-14 h-14 rounded-2xl bg-dark-card border border-dark-border flex items-center justify-center">
            <MessageCircle className="w-6 h-6 text-ink-muted opacity-50" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-ink-secondary">{t('nav.emptyTitle')}</p>
            <p className="text-xs text-ink-muted mt-0.5">{t('nav.emptyHint')}</p>
          </div>
        </div>
      )}

      <PermissionInbox />
      <AddContactDialog />
    </div>
  );
}
