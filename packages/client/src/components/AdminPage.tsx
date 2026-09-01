import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateLocale, type TranslationKey } from '../i18n/index.js';
import { DISABLED, FOCUS_RING } from '../lib/styles.js';
import {
  type AdminAgent,
  type AdminConversation,
  type AdminUser,
  useAdminStore,
} from '../stores/admin.js';
import { useAuthStore } from '../stores/auth.js';
import { MessageCircle, Settings, Shield, Users } from './Icons.js';
import { type PageTab, TabbedPage } from './TabbedPage.js';

type Tab = 'overview' | 'users' | 'content' | 'config';

// Every moderation action in this page is the same interaction: confirm, then
// run while the row's buttons are disabled. Sharing it keeps a row from
// double-submitting because someone forgot the `finally`.
function useConfirmedAction() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (confirmKey: TranslationKey, action: () => Promise<void>) => {
    if (!window.confirm(t(confirmKey))) return;
    setBusy(true);
    setFailed(false);
    try {
      await action();
    } catch {
      // The store's write actions intentionally don't swallow errors, and the
      // page-level banner is wired only to the *load* path. Without catching
      // here the rejection escapes an un-awaited onClick: the row simply
      // re-enables and the admin is left believing a moderation action applied
      // when it never did. The reason isn't shown — a gateway message would
      // reach en/ja admins in the wrong language — so this reports the failure
      // and leaves the retry to them.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return { busy, failed, run };
}

// Inline "that didn't apply" marker for a row whose last action failed. It sits
// in a flex button row (users) and in a plain end-aligned cell (agents,
// conversations), hence both the flex and the inline alignment class.
function ActionFailed() {
  const { t } = useTranslation();
  return (
    <span className="text-[11px] text-red-400 self-center align-middle me-2">
      {t('admin.actionError')}
    </span>
  );
}

// A table-row action link. `tone` is the only thing that varies between them;
// everything else (size, hover, disabled treatment) is shared by all six.
function RowAction({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: 'neutral' | 'primary' | 'positive' | 'destructive';
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  const toneClass = {
    neutral: 'text-ink-secondary',
    primary: 'text-primary-400',
    positive: 'text-green-400',
    destructive: 'text-red-400',
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded-md ${toneClass} hover:bg-dark-hover ${DISABLED}`}
    >
      {children}
    </button>
  );
}

function OperationsOverview() {
  const { t } = useTranslation();
  const stats = useAdminStore((s) => s.stats);
  const loadingStats = useAdminStore((s) => s.loadingStats);
  const loadStats = useAdminStore((s) => s.loadStats);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const cards: { labelKey: TranslationKey; value: number | undefined }[] = [
    { labelKey: 'admin.statsUsers', value: stats?.users },
    { labelKey: 'admin.statsConversations', value: stats?.conversations },
    { labelKey: 'admin.statsContacts', value: stats?.contacts },
    { labelKey: 'admin.statsMessages', value: stats?.messages },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 max-w-2xl">
      {cards.map(({ labelKey, value }) => (
        <div key={labelKey} className="px-5 py-4 bg-dark-card border border-dark-border rounded-xl">
          <p className="text-xs text-ink-muted mb-2">{t(labelKey)}</p>
          <p className="text-2xl font-semibold text-ink-primary font-mono">
            {loadingStats || value === undefined ? '—' : value}
          </p>
        </div>
      ))}
    </div>
  );
}

function UserRow({ u, selfId }: { u: AdminUser; selfId: string | undefined }) {
  const { t } = useTranslation();
  const updateUser = useAdminStore((s) => s.updateUser);
  const { busy, failed, run } = useConfirmedAction();
  const isSelf = u.id === selfId;

  const roleLabel = u.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleMember');
  const statusLabel = u.status === 'disabled' ? t('admin.statusDisabled') : t('admin.statusActive');

  return (
    <tr className="border-t border-dark-border">
      <td className="py-2.5 px-3">
        <span className="text-sm text-ink-primary">{u.display_name || u.username}</span>
        <span className="block text-[11px] text-ink-muted font-mono">@{u.username}</span>
      </td>
      <td className="py-2.5 px-3">
        <span className="text-xs text-ink-secondary">{roleLabel}</span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs ${u.status === 'disabled' ? 'text-red-400' : 'text-green-400'}`}>
          {statusLabel}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-ink-muted">
        {new Date(u.created_at).toLocaleDateString(dateLocale())}
      </td>
      <td className="py-2.5 px-3 text-end">
        {isSelf ? (
          <span className="text-[11px] text-ink-muted">{t('admin.selfHint')}</span>
        ) : (
          <div className="flex gap-2 justify-end">
            {failed && <ActionFailed />}
            {u.role === 'admin' ? (
              <RowAction
                tone="neutral"
                disabled={busy}
                onClick={() =>
                  run('admin.confirmDemote', () => updateUser(u.id, { role: 'member' }))
                }
              >
                {t('admin.actionDemote')}
              </RowAction>
            ) : (
              <RowAction
                tone="primary"
                disabled={busy}
                onClick={() =>
                  run('admin.confirmPromote', () => updateUser(u.id, { role: 'admin' }))
                }
              >
                {t('admin.actionPromote')}
              </RowAction>
            )}
            {u.status === 'disabled' ? (
              <RowAction
                tone="positive"
                disabled={busy}
                onClick={() =>
                  run('admin.confirmEnable', () => updateUser(u.id, { status: 'active' }))
                }
              >
                {t('admin.actionEnable')}
              </RowAction>
            ) : (
              <RowAction
                tone="destructive"
                disabled={busy}
                onClick={() =>
                  run('admin.confirmDisable', () => updateUser(u.id, { status: 'disabled' }))
                }
              >
                {t('admin.actionDisable')}
              </RowAction>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

// Shared by all three admin lists. Extracted when Content moderation turned out
// to load `{page: 1}` and then render no controls at all, leaving every agent
// and conversation past the twentieth unreachable — the store had been tracking
// the totals for it the whole time.
function Pager({
  total,
  page,
  pageSize,
  busy,
  onPage,
}: {
  total: number;
  page: number;
  pageSize: number;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const btn = `text-xs px-3 py-1.5 rounded-md text-ink-secondary hover:bg-dark-hover ${DISABLED} ${FOCUS_RING}`;

  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs text-ink-muted">{t('admin.total', { count: total })}</span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1 || busy}
          onClick={() => onPage(page - 1)}
          className={btn}
        >
          {t('admin.prev')}
        </button>
        <button
          type="button"
          disabled={page >= lastPage || busy}
          onClick={() => onPage(page + 1)}
          className={btn}
        >
          {t('admin.next')}
        </button>
      </div>
    </div>
  );
}

function UserManagement() {
  const { t } = useTranslation();
  const users = useAdminStore((s) => s.users);
  const total = useAdminStore((s) => s.total);
  const page = useAdminStore((s) => s.page);
  const pageSize = useAdminStore((s) => s.pageSize);
  const loadingUsers = useAdminStore((s) => s.loadingUsers);
  const error = useAdminStore((s) => s.error);
  const loadUsers = useAdminStore((s) => s.loadUsers);
  const selfId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadUsers({ page: 1 });
  }, [loadUsers]);

  return (
    <div className="max-w-3xl space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          loadUsers({ page: 1, query: search });
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.searchPlaceholder')}
          className={`w-64 px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary placeholder:text-ink-muted ${FOCUS_RING}`}
        />
      </form>

      {error && <p className="text-xs text-red-400">{t('admin.loadError')}</p>}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="text-start">
              <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                {t('admin.usersColUser')}
              </th>
              <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                {t('admin.usersColRole')}
              </th>
              <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                {t('admin.usersColStatus')}
              </th>
              <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                {t('admin.usersColCreated')}
              </th>
              <th className="py-2 px-3 text-[11px] font-medium text-ink-muted text-end">
                {t('admin.usersColActions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} u={u} selfId={selfId} />
            ))}
          </tbody>
        </table>
      </div>

      {!loadingUsers && users.length === 0 && (
        <p className="text-sm text-ink-muted py-4">{t('admin.empty')}</p>
      )}

      <Pager
        total={total}
        page={page}
        pageSize={pageSize}
        busy={loadingUsers}
        onPage={(next) => loadUsers({ page: next })}
      />
    </div>
  );
}

function AgentRow({ a }: { a: AdminAgent }) {
  const { t } = useTranslation();
  const updateAgent = useAdminStore((s) => s.updateAgent);
  const { busy, failed, run } = useConfirmedAction();
  const suspended = a.status === 'suspended';

  return (
    <tr className="border-t border-dark-border">
      <td className="py-2.5 px-3">
        <span className="text-sm text-ink-primary">{a.name || a.did}</span>
        <span className="block text-[11px] text-ink-muted font-mono">{a.did}</span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs ${suspended ? 'text-red-400' : 'text-green-400'}`}>
          {suspended ? t('admin.agentStatusSuspended') : t('admin.agentStatusActive')}
        </span>
      </td>
      <td className="py-2.5 px-3 text-end">
        {failed && <ActionFailed />}
        {suspended ? (
          <RowAction
            tone="positive"
            disabled={busy}
            onClick={() => run('admin.confirmRestoreAgent', () => updateAgent(a.id, 'active'))}
          >
            {t('admin.actionRestore')}
          </RowAction>
        ) : (
          <RowAction
            tone="destructive"
            disabled={busy}
            onClick={() => run('admin.confirmSuspend', () => updateAgent(a.id, 'suspended'))}
          >
            {t('admin.actionSuspend')}
          </RowAction>
        )}
      </td>
    </tr>
  );
}

function ConversationRow({ conv }: { conv: AdminConversation }) {
  const { t } = useTranslation();
  const updateConversation = useAdminStore((s) => s.updateConversation);
  const { busy, failed, run } = useConfirmedAction();
  const hidden = conv.moderation_status === 'hidden';

  return (
    <tr className="border-t border-dark-border">
      <td className="py-2.5 px-3">
        <span className="text-sm text-ink-primary">{conv.name || t('admin.convUntitled')}</span>
        <span className="block text-[11px] text-ink-muted font-mono">{conv.id}</span>
      </td>
      <td className="py-2.5 px-3">
        <span className={`text-xs ${hidden ? 'text-red-400' : 'text-green-400'}`}>
          {hidden ? t('admin.convStatusHidden') : t('admin.convStatusVisible')}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-ink-muted">
        {new Date(conv.created_at).toLocaleDateString(dateLocale())}
      </td>
      <td className="py-2.5 px-3 text-end">
        {failed && <ActionFailed />}
        {hidden ? (
          <RowAction
            tone="positive"
            disabled={busy}
            onClick={() => run('admin.confirmUnhide', () => updateConversation(conv.id, 'visible'))}
          >
            {t('admin.actionUnhide')}
          </RowAction>
        ) : (
          <RowAction
            tone="destructive"
            disabled={busy}
            onClick={() => run('admin.confirmHide', () => updateConversation(conv.id, 'hidden'))}
          >
            {t('admin.actionHide')}
          </RowAction>
        )}
      </td>
    </tr>
  );
}

function ContentModeration() {
  const { t } = useTranslation();
  const agents = useAdminStore((s) => s.agents);
  const agentsTotal = useAdminStore((s) => s.agentsTotal);
  const agentsPage = useAdminStore((s) => s.agentsPage);
  const loadingAgents = useAdminStore((s) => s.loadingAgents);
  const conversations = useAdminStore((s) => s.conversations);
  const conversationsTotal = useAdminStore((s) => s.conversationsTotal);
  const conversationsPage = useAdminStore((s) => s.conversationsPage);
  const loadingConversations = useAdminStore((s) => s.loadingConversations);
  const pageSize = useAdminStore((s) => s.pageSize);
  const error = useAdminStore((s) => s.error);
  const loadAgents = useAdminStore((s) => s.loadAgents);
  const loadConversations = useAdminStore((s) => s.loadConversations);

  useEffect(() => {
    loadAgents({ page: 1 });
    loadConversations({ page: 1 });
  }, [loadAgents, loadConversations]);

  return (
    <div className="max-w-3xl space-y-8">
      {error && <p className="text-xs text-red-400">{t('admin.loadError')}</p>}

      <section>
        <h3 className="text-sm font-medium text-ink-secondary mb-3">{t('admin.contentAgents')}</h3>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="text-start">
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                  {t('admin.agentColName')}
                </th>
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                  {t('admin.agentColStatus')}
                </th>
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted text-end">
                  {t('admin.agentColActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <AgentRow key={a.id} a={a} />
              ))}
            </tbody>
          </table>
        </div>
        {agents.length === 0 && <p className="text-sm text-ink-muted py-4">{t('admin.empty')}</p>}
        <Pager
          total={agentsTotal}
          page={agentsPage}
          pageSize={pageSize}
          busy={loadingAgents}
          onPage={(next) => loadAgents({ page: next })}
        />
      </section>

      <section>
        <h3 className="text-sm font-medium text-ink-secondary mb-3">
          {t('admin.contentConversations')}
        </h3>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="text-start">
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                  {t('admin.convColName')}
                </th>
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                  {t('admin.convColStatus')}
                </th>
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted">
                  {t('admin.convColCreated')}
                </th>
                <th className="py-2 px-3 text-[11px] font-medium text-ink-muted text-end">
                  {t('admin.convColActions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {conversations.map((conv) => (
                <ConversationRow key={conv.id} conv={conv} />
              ))}
            </tbody>
          </table>
        </div>
        {conversations.length === 0 && (
          <p className="text-sm text-ink-muted py-4">{t('admin.empty')}</p>
        )}
        <Pager
          total={conversationsTotal}
          page={conversationsPage}
          pageSize={pageSize}
          busy={loadingConversations}
          onPage={(next) => loadConversations({ page: next })}
        />
      </section>
    </div>
  );
}

function GlobalConfig() {
  const { t } = useTranslation();
  const config = useAdminStore((s) => s.config);
  const loadConfig = useAdminStore((s) => s.loadConfig);
  const updateConfig = useAdminStore((s) => s.updateConfig);
  const [instanceName, setInstanceName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (config) setInstanceName(config.instance_name);
  }, [config]);

  if (!config) {
    return <p className="text-sm text-ink-muted">—</p>;
  }

  const toggleRegistration = async () => {
    setSaveError(false);
    try {
      await updateConfig({ registration_open: !config.registration_open });
    } catch {
      setSaveError(true);
    }
  };

  const saveInstanceName = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      await updateConfig({ instance_name: instanceName });
      setSaved(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between px-4 py-3 bg-dark-card border border-dark-border rounded-xl">
        <div>
          <p className="text-sm text-ink-primary">{t('admin.configRegistrationOpen')}</p>
          <p className="text-xs text-ink-muted mt-0.5">{t('admin.configRegistrationOpenHint')}</p>
        </div>
        <button
          type="button"
          onClick={toggleRegistration}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            config.registration_open ? 'bg-primary-600' : 'bg-dark-border'
          }`}
        >
          <span
            // `start-0.5` parks the knob at the inline start, but the travel is
            // a transform, and there is no logical translate — so the RTL
            // variant has to mirror it explicitly or the knob slides off the
            // track instead of across it.
            className={`absolute top-0.5 start-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              config.registration_open ? 'translate-x-5 rtl:-translate-x-5' : ''
            }`}
          />
        </button>
      </div>

      <div className="px-4 py-3 bg-dark-card border border-dark-border rounded-xl space-y-2">
        <label htmlFor="instance-name" className="text-sm text-ink-primary">
          {t('admin.configInstanceName')}
        </label>
        <div className="flex gap-2">
          <input
            id="instance-name"
            type="text"
            value={instanceName}
            onChange={(e) => {
              setInstanceName(e.target.value);
              setSaved(false);
            }}
            className={`flex-1 px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary ${FOCUS_RING}`}
          />
          <button
            type="button"
            disabled={saving || instanceName.trim().length === 0}
            onClick={saveInstanceName}
            className={`text-xs px-4 py-2 rounded-lg bg-primary-600/15 text-primary-400 hover:bg-primary-600/25 ${DISABLED}`}
          >
            {t('admin.configSave')}
          </button>
        </div>
        {saved && <p className="text-xs text-green-400">{t('admin.configSaved')}</p>}
        {saveError && <p className="text-xs text-red-400">{t('admin.configSaveError')}</p>}
      </div>
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: PageTab<Tab>[] = [
    { id: 'overview', label: t('admin.tabOverview'), icon: Shield },
    { id: 'users', label: t('admin.tabUsers'), icon: Users },
    { id: 'content', label: t('admin.tabContent'), icon: MessageCircle },
    { id: 'config', label: t('admin.tabConfig'), icon: Settings },
  ];

  return (
    <TabbedPage title={t('admin.title')} tabs={tabs} activeTab={tab} onTabChange={setTab}>
      {tab === 'overview' && <OperationsOverview />}
      {tab === 'users' && <UserManagement />}
      {tab === 'content' && <ContentModeration />}
      {tab === 'config' && <GlobalConfig />}
    </TabbedPage>
  );
}
