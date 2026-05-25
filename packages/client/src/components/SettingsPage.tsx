import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';
import { ArrowLeft, User, Bot, Key } from './Icons.js';

type Tab = 'profile' | 'agent' | 'keys';

const LLM_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'qwen', name: 'Qwen' },
];

function ProfileTab() {
  const { user } = useAuthStore();
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
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">DID</label>
        <input
          type="text"
          value={user?.did ?? ''}
          disabled
          className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm font-mono"
        />
        <p className="text-xs text-gray-400 mt-1">你的去中心化身份标识，由系统自动生成</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
        <input
          type="text"
          value={user?.display_name ?? ''}
          disabled
          className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 text-sm"
        />
      </div>
    </div>
  );
}

function AgentTab() {
  const { agent, loading, saving, error, success, loadAgent, updateAgent, clearMessages } =
    useSettingsStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  useEffect(() => {
    if (agent) {
      setName(agent.name ?? '');
      setDescription(agent.description ?? '');
      setModel(agent.default_model ?? '');
      setPrompt(agent.system_prompt ?? '');
    }
  }, [agent]);

  useEffect(() => {
    if (success || error) {
      const t = setTimeout(clearMessages, 3000);
      return () => clearTimeout(t);
    }
  }, [success, error, clearMessages]);

  const handleSave = () => {
    updateAgent({
      name: name || undefined,
      description: description || undefined,
      default_model: model || undefined,
      system_prompt: prompt || undefined,
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
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述你的 Agent 能做什么..."
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">默认模型</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="">选择模型</option>
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
          <option value="deepseek-chat">DeepSeek Chat</option>
          <option value="deepseek-reasoner">DeepSeek Reasoner</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">系统提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="自定义 Agent 的行为和角色..."
          rows={4}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono"
        />
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        配置 LLM API 密钥，密钥将被加密存储在服务端，绝不会发送到客户端。
      </p>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <div className="space-y-3">
        {LLM_PROVIDERS.map((provider) => {
          const keyInfo = llmKeys.find((k) => k.provider === provider.id);
          const isConfigured = keyInfo?.configured ?? false;
          const isEditing = editing === provider.id;

          return (
            <div key={provider.id} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-medium text-gray-700">{provider.name}</span>
                  {isConfigured && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">已配置</span>
                  )}
                </div>
                <div className="flex gap-2">
                  {!isEditing && (
                    <button
                      onClick={() => { setEditing(provider.id); setKeyValue(''); }}
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
                    type="password"
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    placeholder="sk-..."
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

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile');
  const navigate = useNavigate();

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: '个人信息', icon: User },
    { id: 'agent', label: 'Agent 配置', icon: Bot },
    { id: 'keys', label: 'LLM 密钥', icon: Key },
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
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
        {/* Settings sidebar */}
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

        {/* Settings content */}
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
