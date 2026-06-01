import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { dateLocale, type TranslationKey } from '../i18n/index.js';
import { type AdminUser, useAdminStore } from '../stores/admin.js';
import { useAuthStore } from '../stores/auth.js';
import { ArrowLeft, Shield, Users } from './Icons.js';

type Tab = 'overview' | 'users';

function OperationsOverview() {
  const { t } = useTranslation();
  const { stats, loadingStats, loadStats } = useAdminStore();

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
  const { updateUser } = useAdminStore();
  const [busy, setBusy] = useState(false);
  const isSelf = u.id === selfId;

  const run = async (patch: { role?: string; status?: string }, confirmKey: TranslationKey) => {
    if (!window.confirm(t(confirmKey))) return;
    setBusy(true);
    try {
      await updateUser(u.id, patch);
    } finally {
      setBusy(false);
    }
  };

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
      <td className="py-2.5 px-3 text-right">
        {isSelf ? (
          <span className="text-[11px] text-ink-muted">{t('admin.selfHint')}</span>
        ) : (
          <div className="flex gap-2 justify-end">
            {u.role === 'admin' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ role: 'member' }, 'admin.confirmDemote')}
                className="text-xs px-2 py-1 rounded-md text-ink-secondary hover:bg-dark-hover disabled:opacity-40"
              >
                {t('admin.actionDemote')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ role: 'admin' }, 'admin.confirmPromote')}
                className="text-xs px-2 py-1 rounded-md text-primary-400 hover:bg-dark-hover disabled:opacity-40"
              >
                {t('admin.actionPromote')}
              </button>
            )}
            {u.status === 'disabled' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ status: 'active' }, 'admin.confirmEnable')}
                className="text-xs px-2 py-1 rounded-md text-green-400 hover:bg-dark-hover disabled:opacity-40"
              >
                {t('admin.actionEnable')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ status: 'disabled' }, 'admin.confirmDisable')}
                className="text-xs px-2 py-1 rounded-md text-red-400 hover:bg-dark-hover disabled:opacity-40"
              >
                {t('admin.actionDisable')}
              </button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

function UserManagement() {
  const { t } = useTranslation();
  const { users, total, page, pageSize, loadingUsers, error, loadUsers } = useAdminStore();
  const selfId = useAuthStore((s) => s.user?.id);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadUsers({ page: 1 });
  }, [loadUsers]);

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

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
          className="w-64 px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40"
        />
      </form>

      {error && <p className="text-xs text-red-400">{t('admin.loadError')}</p>}

      <table className="w-full">
        <thead>
          <tr className="text-left">
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
            <th className="py-2 px-3 text-[11px] font-medium text-ink-muted text-right">
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

      {!loadingUsers && users.length === 0 && (
        <p className="text-sm text-ink-muted py-4">{t('admin.empty')}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-ink-muted">{t('admin.total', { count: total })}</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loadingUsers}
            onClick={() => loadUsers({ page: page - 1 })}
            className="text-xs px-3 py-1.5 rounded-md text-ink-secondary hover:bg-dark-hover disabled:opacity-40"
          >
            {t('admin.prev')}
          </button>
          <button
            type="button"
            disabled={page >= lastPage || loadingUsers}
            onClick={() => loadUsers({ page: page + 1 })}
            className="text-xs px-3 py-1.5 rounded-md text-ink-secondary hover:bg-dark-hover disabled:opacity-40"
          >
            {t('admin.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('overview');
  const navigate = useNavigate();

  const tabs: { id: Tab; label: string; icon: typeof Shield }[] = [
    { id: 'overview', label: t('admin.tabOverview'), icon: Shield },
    { id: 'users', label: t('admin.tabUsers'), icon: Users },
  ];

  return (
    <div className="h-screen flex flex-col bg-dark-base">
      <header className="h-13 bg-dark-nav border-b border-dark-border flex items-center px-4 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="p-1.5 -ml-1 text-ink-muted hover:text-ink-secondary hover:bg-dark-hover rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h1 className="font-semibold text-sm text-ink-primary ml-2">{t('admin.title')}</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-52 bg-dark-panel border-r border-dark-border p-2 space-y-0.5 shrink-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                tab === id
                  ? 'bg-primary-600/15 text-primary-400 font-medium'
                  : 'text-ink-secondary hover:bg-dark-hover hover:text-ink-primary'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-8 bg-dark-base">
          <h2 className="text-base font-semibold text-ink-primary mb-6">
            {tabs.find((item) => item.id === tab)?.label}
          </h2>
          {tab === 'overview' && <OperationsOverview />}
          {tab === 'users' && <UserManagement />}
        </div>
      </div>
    </div>
  );
}
