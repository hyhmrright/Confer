import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';
import { api } from '../lib/api.js';
import { ArrowLeft, User, Bot, Key } from './Icons.js';

type Tab = 'profile' | 'agent' | 'keys';

const INPUT_CN =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

function StatusMsg({ error, success }: { error: string | null; success: string | null }) {
  return (
    <>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}
    </>
  );
}

const LLM_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'qwen', name: '通义千问 (Qwen)' },
  { id: 'glm', name: '智谱 AI (GLM)' },
  { id: 'ollama', name: 'Ollama (本地)', isLocal: true },
];

const STATIC_MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-opus-4-7', label: 'Claude Opus 4.7（旗舰）' },
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6（高性价比）' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（轻量）' },
  ],
  openai: [
    { value: 'o3', label: 'o3（旗舰推理）' },
    { value: 'o4-mini', label: 'o4-mini（高性价比推理）' },
    { value: 'gpt-4.1', label: 'GPT-4.1（长上下文旗舰）' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini（高性价比）' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 nano（最经济）' },
    { value: 'gpt-4o', label: 'GPT-4o（多模态）' },
    { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  deepseek: [
    { value: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro（旗舰）' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash（高性价比）' },
  ],
  qwen: [
    { value: 'qwen3-max', label: 'Qwen3-Max（旗舰）' },
    { value: 'qwq-plus', label: 'QwQ-Plus（推理）' },
    { value: 'qwen3.5-plus', label: 'Qwen3.5-Plus（超长上下文）' },
    { value: 'qwen3.5-flash', label: 'Qwen3.5-Flash（轻量）' },
    { value: 'qwen-plus', label: 'Qwen-Plus（稳定别名）' },
    { value: 'qwen-flash', label: 'Qwen-Flash（轻量别名）' },
    { value: 'qwen-long', label: 'Qwen-Long（超长文档）' },
  ],
  glm: [
    { value: 'glm-5.1', label: 'GLM-5.1（旗舰）' },
    { value: 'glm-5-turbo', label: 'GLM-5-Turbo（高性价比）' },
    { value: 'glm-4.7', label: 'GLM-4.7（通用）' },
    { value: 'glm-4.7-flash', label: 'GLM-4.7-Flash（免费）' },
    { value: 'glm-4.5-air', label: 'GLM-4.5-Air（高性价比）' },
    { value: 'glm-4.5-flash', label: 'GLM-4.5-Flash（免费）' },
  ],
  ollama: [],
};

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
      const t = setTimeout(() => { setSuccess(null); setError(null); }, 3000);
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
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
        <input
          type="text"
          value={user?.username ?? ''}
          disabled
          className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm"
        />
        <p className="text-xs text-gray-400 mt-1">用户名不可修改</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">DID</label>
        <input
          type="text"
          value={user?.did ?? ''}
          disabled
          className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm font-mono"
        />
        <p className="text-xs text-gray-400 mt-1">去中心化身份标识，由系统生成，不可修改</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="输入显示名称"
          className={INPUT_CN}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">邮箱</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="输入邮箱地址"
          className={INPUT_CN}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">手机号</label>
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
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 transition-colors"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  );
}

function AgentTab() {
  const { agent, loading, saving, error, success, loadAgent, updateAgent, fetchModels, clearMessages } =
    useSettingsStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [dynamicModels, setDynamicModels] = useState<{ value: string; label: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => { loadAgent(); }, [loadAgent]);

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
        const data = await resp.json() as { models?: { name: string }[] };
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
    return <div className="text-sm text-gray-400 py-8 text-center">加载中...</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Agent 名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="我的 AI 助手"
          className={INPUT_CN}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述你的 Agent 能做什么..."
          rows={2}
          className={`${INPUT_CN} resize-none`}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">模型提供商</label>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className={INPUT_CN}
        >
          <option value="">选择提供商</option>
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {provider && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            模型
            {loadingModels && <span className="text-gray-400 font-normal ml-2">查询中...</span>}
          </label>
          {modelOptions.length > 0 ? (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={INPUT_CN}
            >
              <option value="">选择模型</option>
              {modelOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === 'ollama' ? '未检测到本地模型，手动输入模型名' : '输入模型名'}
              className={INPUT_CN}
            />
          )}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">系统提示词</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="自定义 Agent 的行为和角色..."
          rows={4}
          className={`${INPUT_CN} resize-none font-mono`}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50 transition-colors"
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

  useEffect(() => { loadLlmKeys(); }, [loadLlmKeys]);

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

  const handleEdit = (providerId: string) => {
    setEditing(providerId);
    setKeyValue(providerId === 'ollama' ? 'http://localhost:11434' : '');
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        配置 LLM API 密钥，密钥将被加密存储在服务端，绝不会发送到客户端。
      </p>

      <StatusMsg error={error} success={success} />

      <div className="space-y-3">
        {LLM_PROVIDERS.map((provider) => {
          const keyInfo = llmKeys.find((k) => k.provider === provider.id);
          const isConfigured = keyInfo?.configured ?? false;
          const isEditing = editing === provider.id;
          const isOllama = provider.id === 'ollama';

          return (
            <div key={provider.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">{provider.name}</span>
                  {isConfigured && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">已配置</span>
                  )}
                  {isOllama && !isConfigured && (
                    <span className="text-xs text-gray-400">无需 API Key，填写服务地址</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isEditing && (
                    <button
                      onClick={() => handleEdit(provider.id)}
                      className="text-xs text-primary-600 hover:text-primary-700"
                    >
                      {isConfigured ? '更新' : '配置'}
                    </button>
                  )}
                  {isConfigured && !isEditing && (
                    <button
                      onClick={() => removeLlmKey(provider.id)}
                      disabled={saving}
                      className="text-xs text-red-500 hover:text-red-600"
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
                    className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                    autoFocus
                  />
                  <button
                    onClick={() => handleSave(provider.id)}
                    disabled={saving || !keyValue.trim()}
                    className="px-3 py-1.5 bg-primary-600 text-white rounded-md text-xs hover:bg-primary-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => { setEditing(null); setKeyValue(''); }}
                    className="px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-500 hover:bg-gray-50"
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
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-5 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="p-2 -ml-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold text-lg text-gray-800 ml-2">设置</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <nav className="w-56 bg-white border-r border-gray-200 p-3 space-y-1 shrink-0">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                tab === id
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-lg">
            <h2 className="text-lg font-semibold text-gray-800 mb-6">
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
