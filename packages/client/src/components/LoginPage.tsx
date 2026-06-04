import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { Loader } from './Icons.js';

export function LoginPage() {
  const { t } = useTranslation();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { login, register, loading, error } = useAuthStore();
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
    text-ink-primary placeholder:text-ink-muted
    focus:outline-none focus:border-primary-600/60 focus:bg-dark-card
    transition-all duration-150 font-sans`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-base">
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#b06844 1px, transparent 1px), linear-gradient(90deg, #b06844 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative w-full max-w-sm px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-900/60">
            <span className="text-white text-xl font-bold font-mono">C</span>
          </div>
          <h1 className="text-2xl font-bold text-ink-primary tracking-tight">Confer</h1>
          <p className="text-sm text-ink-muted mt-1">{t('login.tagline')}</p>
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                className={inputCls}
                required
                minLength={8}
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium
                hover:bg-primary-500 disabled:opacity-40 transition-colors flex items-center justify-center gap-2 mt-1"
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
