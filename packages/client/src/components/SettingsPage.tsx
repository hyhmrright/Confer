import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { LLM_PROVIDERS, STATIC_MODELS, TOOL_PROVIDERS } from '../lib/providers.js';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';
import { ArrowLeft, Bot, Key, User } from './Icons.js';

type Tab = 'profile' | 'agent' | 'keys';

const INPUT_CN =
  'w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors';

const SELECT_CN =
  'w-full px-3 py-2 bg-dark-input border border-dark-border rounded-lg text-sm text-ink-primary focus:outline-none focus:border-primary-600/40 transition-colors appearance-none';

function StatusMsg({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error && (
        <div className="px-3 py-2 bg-red-900/20 border border-red-800/40 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}
      {success && (
        <div className="px-3 py-2 bg-green-900/20 border border-green-800/40 rounded-lg">
          <p className="text-green-400 text-xs">{success}</p>
        </div>
      )}
    </>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  // Visual field label rendered above (but not htmlFor-bound to) its control;
  // a span avoids a label-without-control a11y error while keeping the styling.
  return <span className="block text-xs font-medium text-ink-secondary mb-1.5">{children}</span>;
}

function ProfileTab() {
  const { user, refreshUser } = useAuthStore();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(user?.display_name ?? '');
    setEmail(user?.email ?? '');
    setPhone(user?.phone ?? '');
  }, [user]);

  useEffect(() => {
    if (success || error) {
      const t = setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [success, error]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.patch('/users/me', {
        display_name: displayName || null,
        email: email || null,
        phone: phone || null,
      });
      await refreshUser();
      setSuccess('保存成功');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>用户名</FieldLabel>
        <input
          type="text"
          value={user?.username ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-sm text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">用户名不可修改</p>
      </div>
      <div>
        <FieldLabel>DID</FieldLabel>
        <input
          type="text"
          value={user?.did ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-xs text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">去中心化身份标识，由系统生成</p>
      </div>
      <div>
        <FieldLabel>显示名称</FieldLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="输入显示名称"
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>邮箱</FieldLabel>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="输入邮箱地址"
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>手机号</FieldLabel>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="输入手机号"
          className={INPUT_CN}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-40 transition-colors"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

function AgentTab() {
  const {
    agent,
    loading,
    saving,
    error,
    success,
    loadAgent,
    updateAgent,
    fetchModels,
    clearMessages,
  } = useSettingsStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [dynamicModels, setDynamicModels] = useState<{ value: string; label: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    if (agent) {
      setName(agent.name ?? '');
      setDescription(agent.description ?? '');
      const cfg = agent.model_config_json ?? {};
      setProvider(cfg.provider ?? '');
      setModel(cfg.model ?? '');
      setSystemPrompt(cfg.system_prompt ?? '');
    }
  }, [agent]);

  useEffect(() => {
    if (success || error) {
      const t = setTimeout(clearMessages, 3000);
      return () => clearTimeout(t);
    }
  }, [success, error, clearMessages]);

  const handleProviderChange = async (p: string) => {
    setProvider(p);
    setModel('');
    setDynamicModels([]);
    if (!p) return;

    setLoadingModels(true);
    try {
      if (p === 'ollama') {
        const resp = await fetch('http://localhost:11434/api/tags');
        const data = (await resp.json()) as { models?: { name: string }[] };
        setDynamicModels((data.models ?? []).map((m) => ({ value: m.name, label: m.name })));
      } else {
        setDynamicModels(await fetchModels(p));
      }
    } catch {
      setDynamicModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const modelOptions = dynamicModels.length > 0 ? dynamicModels : (STATIC_MODELS[provider] ?? []);

  const handleSave = () => {
    updateAgent({
      name: name || undefined,
      description: description || undefined,
      model_config_json: {
        provider: provider || undefined,
        model: model || undefined,
        system_prompt: systemPrompt || undefined,
      },
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-12">
        <div className="flex gap-1.5">
          {[0, 150, 300].map((d) => (
            <span
              key={d}
              className="w-1.5 h-1.5 rounded-full bg-dark-border animate-bounce"
              style={{ animationDelay: `${d}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>Agent 名称</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="我的 AI 助手"
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>描述</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述你的 Agent 能做什么..."
          rows={2}
          className={`${INPUT_CN} resize-none`}
        />
      </div>
      <div>
        <FieldLabel>模型提供商</FieldLabel>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className={SELECT_CN}
        >
          <option value="">选择提供商</option>
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {provider && (
        <div>
          <FieldLabel>
            模型
            {loadingModels && (
              <span className="text-ink-muted font-normal ml-2 text-[11px]">查询中...</span>
            )}
          </FieldLabel>
          {modelOptions.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={SELECT_CN}>
              <option value="">选择模型</option>
              {modelOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={
                provider === 'ollama' ? '未检测到本地模型，手动输入模型名' : '输入模型名'
              }
              className={INPUT_CN}
            />
          )}
        </div>
      )}
      <div>
        <FieldLabel>系统提示词</FieldLabel>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="自定义 Agent 的行为和角色..."
          rows={5}
          className={`${INPUT_CN} resize-none font-mono text-xs`}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-40 transition-colors"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

function KeysTab() {
  const { llmKeys, saving, error, success, loadLlmKeys, saveLlmKey, removeLlmKey, clearMessages } =
    useSettingsStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState('');

  useEffect(() => {
    loadLlmKeys();
  }, [loadLlmKeys]);

  useEffect(() => {
    if (success || error) {
      const t = setTimeout(clearMessages, 3000);
      return () => clearTimeout(t);
    }
  }, [success, error, clearMessages]);

  const handleSave = async (provider: string) => {
    if (!keyValue.trim()) return;
    await saveLlmKey(provider, keyValue.trim());
    setEditing(null);
    setKeyValue('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setKeyValue('');
  };

  const handleEdit = (providerId: string) => {
    setEditing(providerId);
    setKeyValue(providerId === 'ollama' ? 'http://localhost:11434' : '');
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted leading-relaxed">
        配置 LLM API 密钥，密钥将被加密存储在服务端，绝不会发送到客户端。
      </p>

      <StatusMsg error={error} success={success} />

      <div className="space-y-2">
        {LLM_PROVIDERS.map((provider) => {
          const keyInfo = llmKeys.find((k) => k.provider === provider.id);
          const isConfigured = keyInfo?.configured ?? false;
          const isEditing = editing === provider.id;
          const isOllama = provider.id === 'ollama';

          return (
            <div
              key={provider.id}
              className="border border-dark-border rounded-xl p-3.5 bg-dark-card"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Key className="w-3.5 h-3.5 text-ink-muted" />
                  <span className="text-sm font-medium text-ink-primary">{provider.name}</span>
                  {provider.supportsEmbedding && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/30">
                      支持知识库
                    </span>
                  )}
                  {isConfigured && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                      已配置
                    </span>
                  )}
                  {isOllama && !isConfigured && (
                    <span className="text-[11px] text-ink-muted">无需 API Key，填写服务地址</span>
                  )}
                </div>
                <div className="flex gap-3">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => handleEdit(provider.id)}
                      className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                    >
                      {isConfigured ? '更新' : '配置'}
                    </button>
                  )}
                  {isConfigured && !isEditing && (
                    <button
                      type="button"
                      onClick={() => removeLlmKey(provider.id)}
                      disabled={saving}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                    >
                      移除
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 flex gap-2">
                  <input
                    type={isOllama ? 'text' : 'password'}
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    placeholder={isOllama ? 'http://localhost:11434' : 'sk-...'}
                    className="flex-1 px-3 py-1.5 bg-dark-input border border-dark-border rounded-lg text-xs font-mono text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(provider.id)}
                    disabled={saving || !keyValue.trim()}
                    className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-500 disabled:opacity-40 transition-colors"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="px-3 py-1.5 border border-dark-border rounded-lg text-xs text-ink-muted hover:text-ink-secondary transition-colors"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        <p className="text-xs font-medium text-ink-secondary mb-2">工具服务</p>
        <div className="space-y-2">
          {TOOL_PROVIDERS.map((tool) => {
            const keyInfo = llmKeys.find((k) => k.provider === tool.id);
            const isConfigured = keyInfo?.configured ?? false;
            const isEditing = editing === tool.id;

            return (
              <div
                key={tool.id}
                className="border border-dark-border rounded-xl p-3.5 bg-dark-card"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Key className="w-3.5 h-3.5 text-ink-muted" />
                    <div>
                      <span className="text-sm font-medium text-ink-primary">{tool.name}</span>
                      {isConfigured && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                          已配置
                        </span>
                      )}
                      <p className="text-[11px] text-ink-muted mt-0.5">{tool.description}</p>
                    </div>
                  </div>
                  <div className="flex gap-3 shrink-0 ml-3">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => handleEdit(tool.id)}
                        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        {isConfigured ? '更新' : '配置'}
                      </button>
                    )}
                    {isConfigured && !isEditing && (
                      <button
                        type="button"
                        onClick={() => removeLlmKey(tool.id)}
                        disabled={saving}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                      >
                        移除
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={keyValue}
                      onChange={(e) => setKeyValue(e.target.value)}
                      placeholder={tool.placeholder}
                      className="flex-1 px-3 py-1.5 bg-dark-input border border-dark-border rounded-lg text-xs font-mono text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-primary-600/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => handleSave(tool.id)}
                      disabled={saving || !keyValue.trim()}
                      className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-500 disabled:opacity-40 transition-colors"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-3 py-1.5 border border-dark-border rounded-lg text-xs text-ink-muted hover:text-ink-secondary transition-colors"
                    >
                      取消
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');
  const navigate = useNavigate();

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'agent', label: 'Agent 配置', icon: Bot },
    { id: 'keys', label: 'LLM 密钥', icon: Key },
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
        <h1 className="font-semibold text-sm text-ink-primary ml-2">设置</h1>
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
          <div className="max-w-lg">
            <h2 className="text-base font-semibold text-ink-primary mb-6">
              {tabs.find((t) => t.id === tab)?.label}
            </h2>
            {tab === 'profile' && <ProfileTab />}
            {tab === 'agent' && <AgentTab />}
            {tab === 'keys' && <KeysTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
