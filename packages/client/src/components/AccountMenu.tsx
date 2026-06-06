import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from './Icons.js';

export type AccountUser = {
  display_name?: string;
  username: string;
  did: string;
};

export function AccountMenu({
  user,
  initials,
  onLogout,
}: {
  user: AccountUser | null;
  initials: string;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const displayName = user?.display_name ?? user?.username ?? '';

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={t('nav.account')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-7 h-7 rounded-full bg-primary-600/20 border border-primary-600/30 flex items-center justify-center hover:bg-primary-600/30 transition-colors"
      >
        <span className="text-[11px] font-semibold text-primary-400 font-mono">{initials}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-full bottom-0 ml-2 w-56 rounded-lg bg-dark-panel border border-dark-border shadow-lg z-50 overflow-hidden"
        >
          <div className="px-3 py-3 border-b border-dark-border">
            <p className="text-sm font-medium text-ink-primary truncate" title={displayName}>
              {displayName}
            </p>
            {user?.username && (
              <p className="text-xs text-ink-muted truncate" title={user.username}>
                @{user.username}
              </p>
            )}
            {user?.did && (
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wider text-ink-muted font-mono">
                  {t('nav.did')}
                </p>
                <p className="text-xs text-ink-secondary font-mono truncate" title={user.did}>
                  {user.did}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onLogout();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-ink-muted hover:text-red-400 hover:bg-dark-hover transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
