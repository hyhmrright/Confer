import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { Loader } from './Icons.js';

export function LoginPage() {
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
          <p className="text-sm text-ink-muted mt-1">AI Agent 协作平台</p>
        </div>

        {/* Card */}
        <div className="bg-dark-panel rounded-2xl border border-dark-border p-8 shadow-2xl shadow-black/40">
          <h2 className="text-base font-semibold text-ink-primary mb-1">
            {isRegister ? '创建账号' : '欢迎回来'}
          </h2>
          <p className="text-xs text-ink-muted mb-6">
            {isRegister ? '注册后即可开始使用' : '登录你的账号'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">用户名</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="至少 3 个字符"
                className={inputCls}
                required
                minLength={3}
                autoFocus
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-xs font-medium text-ink-secondary mb-1.5">
                  显示名称 <span className="text-ink-muted font-normal">（可选）</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="你的昵称"
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-ink-secondary mb-1.5">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 个字符"
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
              {loading ? '处理中...' : isRegister ? '注册' : '登录'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-ink-muted mt-6">
          {isRegister ? '已有账号？' : '没有账号？'}
          <button
            onClick={() => setIsRegister(!isRegister)}
            className="text-primary-400 hover:text-primary-300 font-medium ml-1 transition-colors"
          >
            {isRegister ? '去登录' : '注册'}
          </button>
        </p>
      </div>
    </div>
  );
}
