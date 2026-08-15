import { permissionRequestEventSchema } from '@confer/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useIsNarrow } from '../hooks/use-is-narrow.js';
import type { TranslationKey } from '../i18n/index.js';
import { setOnTokenRefreshed } from '../lib/api.js';
import { FOCUS_RING } from '../lib/styles.js';
import {
  connectWs,
  disconnectWs,
  onWsMessage,
  reconnectWs,
  subscribeConversation,
  unsubscribeConversation,
} from '../lib/ws.js';
import { useAuthStore } from '../stores/auth.js';
import { useChatStore } from '../stores/chat.js';
import { useErrandsStore } from '../stores/errands.js';
import { usePermissionsStore } from '../stores/permissions.js';
import { AccountMenu, type AccountUser } from './AccountMenu.js';
import { AddContactDialog } from './AddContactDialog.js';
import { ErrandInbox } from './ErrandInbox.js';
import { BookOpen, Database, Menu, MessageCircle, Settings, Shield, Users } from './Icons.js';
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
  const loadPendingCards = useErrandsStore((s) => s.loadPendingCards);
  const navigate = useNavigate();

  // Errand decision cards arrive by polling (not WebSocket): pull the pending
  // inbox on mount and on a fixed interval while the layout is open.
  useEffect(() => {
    loadPendingCards();
    const timer = setInterval(loadPendingCards, 15_000);
    return () => clearInterval(timer);
  }, [loadPendingCards]);

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
        const parsed = permissionRequestEventSchema.safeParse(data);
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

  // Subscribe the socket to the active conversation so its gateway broadcasts
  // (inbound peer messages, agent auto-replies) arrive in real time; unsubscribe
  // on switch/unmount. Kept separate from the socket-lifecycle effect above so
  // switching conversations never tears down the socket. ws.ts remembers the
  // desired subscription and replays it on reconnect.
  useEffect(() => {
    if (!activeConversationId) return;
    subscribeConversation(activeConversationId);
    return () => unsubscribeConversation(activeConversationId);
  }, [activeConversationId]);

  const initials = (user?.display_name ?? user?.username ?? '?').charAt(0).toUpperCase();

  const handleLogout = () => {
    disconnectWs();
    logout();
  };

  // The 52px rail plus the 260px sidebar are 312px of fixed chrome, which leaves
  // nothing for content on a phone. Below `md` they become one overlay drawer.
  const narrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerShown = narrow && drawerOpen;

  // Growing past the breakpoint turns the drawer back into ordinary layout, so
  // the "open" flag has to stop meaning anything or main would stay inert.
  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    if (!drawerShown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerShown]);

  const activeNavLabel = NAV_ITEMS.find((item) => item.id === tab)?.labelKey ?? 'nav.conversations';

  return (
    <div className="h-screen flex flex-col md:flex-row bg-dark-base text-ink-primary overflow-hidden">
      {/* Below md this bar is the only way to reach navigation at all. It goes
          inert alongside the content once the drawer is open, so the hamburger
          can't be focused while claiming to be expanded and doing nothing. */}
      <header
        className="md:hidden shrink-0 h-12 flex items-center gap-2 px-3 bg-dark-nav border-b border-dark-border"
        inert={drawerShown}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t('nav.openMenu')}
          aria-expanded={drawerShown}
          aria-controls="app-drawer"
          className={`p-1.5 -ml-1 rounded-lg text-ink-secondary hover:text-ink-primary hover:bg-dark-hover transition-colors ${FOCUS_RING}`}
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="text-sm font-medium text-ink-primary">{t(activeNavLabel)}</span>
      </header>

      {drawerShown && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          aria-label={t('nav.closeMenu')}
          className="md:hidden fixed inset-0 z-30 bg-black/50 backdrop-blur-xs"
        />
      )}

      {/*
        `md:contents` dissolves this wrapper at desktop widths, so the rail and
        sidebar stay direct flex children of the row and the wide layout is
        byte-for-byte what it was. Below md the wrapper becomes the drawer, and
        `hidden` — rather than a transform parked off-screen — is what keeps its
        controls out of the tab order while it is closed.
      */}
      <div
        id="app-drawer"
        className={`md:contents ${
          drawerShown
            ? 'fixed inset-y-0 left-0 z-40 flex animate-slide-in-left shadow-2xl shadow-black/50'
            : 'hidden'
        }`}
      >
        <NavRail
          tab={tab}
          setTab={(next) => {
            setTab(next);
            setDrawerOpen(false);
          }}
          initials={initials}
          isAdmin={user?.role === 'admin'}
          onAdmin={() => navigate('/admin')}
          onSettings={() => navigate('/settings')}
          user={user}
          onLogout={handleLogout}
        />

        <Sidebar tab={tab} onLogout={handleLogout} onNavigate={() => setDrawerOpen(false)} />
      </div>

      {/* Inert while the drawer covers it, so Tab stays in the drawer without a
          hand-rolled focus trap. */}
      <div className="flex-1 flex min-h-0 min-w-0" inert={drawerShown}>
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
      </div>

      <PermissionInbox />
      <ErrandInbox />
      <AddContactDialog />
    </div>
  );
}
