import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { FOCUS_RING } from '../lib/styles.js';
import { useAuthStore } from '../stores/auth.js';
import { Loader } from './Icons.js';

export function LoginPage() {
  const { t } = useTranslation();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await register(username, password, displayName || undefined);
      } else {
        await login(username, password);
      }
      navigate('/');
    } catch {
      // error is set in store
    }
  };

  const inputCls = `w-full px-3.5 py-2.5 bg-dark-input border border-dark-border rounded-xl text-sm
    text-ink-primary placeholder:text-ink-muted focus:bg-dark-card ${FOCUS_RING}
    transition-all duration-150 font-sans`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-base">
      {/* Ruled ground — the faint blue lines of a correspondence pad. Horizontal
          only: a full grid read as generic technical wallpaper, and this is the
          one screen where the product should look like stationery. The colour
          reads from the seal token rather than repeating a literal hex, which is
          how the old value drifted off-palette and stayed there. */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'linear-gradient(var(--color-primary-400) 1px, transparent 1px)',
          backgroundSize: '100% 32px',
        }}
      />

      <div className="relative w-full max-w-sm px-4">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <div className="w-11 h-11 rounded-lg bg-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-900/60">
            <span className="text-white text-lg font-bold font-mono">C</span>
          </div>
          <h1 className="font-display text-3xl text-ink-primary">Confer</h1>
          <p className="text-sm text-ink-secondary mt-1.5">{t('login.tagline')}</p>
        </div>

        {/* Card */}
        <div className="bg-dark-panel rounded-2xl border border-dark-border p-8 shadow-2xl shadow-black/40">
          <h2 className="text-base font-semibold text-ink-primary mb-1">
            {isRegister ? t('login.createAccount') : t('login.welcomeBack')}
          </h2>
          <p className="text-xs text-ink-muted mb-6">
            {isRegister ? t('login.registerHint') : t('login.loginHint')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-medium text-ink-secondary mb-1.5"
              >
                {t('login.username')}
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('login.usernamePlaceholder')}
                className={inputCls}
                required
                minLength={3}
              />
            </div>

            {isRegister && (
              <div>
                <label
                  htmlFor="login-displayname"
                  className="block text-xs font-medium text-ink-secondary mb-1.5"
                >
                  {t('login.displayName')}{' '}
                  <span className="text-ink-muted font-normal">{t('common.optional')}</span>
                </label>
                <input
                  id="login-displayname"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('login.displayNamePlaceholder')}
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-medium text-ink-secondary mb-1.5"
              >
                {t('login.password')}
              </label>
              <input
                id="login-password"
                type="password"
                // One field serving both modes: telling the password manager
                // which it is, is the difference between offering the saved
                // credential and offering to generate a new one.
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                className={inputCls}
                required
                minLength={8}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg"
              >
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium
                hover:bg-primary-500 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 mt-1 ${FOCUS_RING}`}
            >
              {loading && <Loader className="w-4 h-4 animate-spin" />}
              {loading
                ? t('login.processing')
                : isRegister
                  ? t('login.register')
                  : t('login.login')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-ink-muted mt-6">
          {isRegister ? t('login.hasAccount') : t('login.noAccount')}
          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            className="text-primary-400 hover:text-primary-300 font-medium ml-1 transition-colors"
          >
            {isRegister ? t('login.goLogin') : t('login.register')}
          </button>
        </p>
      </div>
    </div>
  );
}
