import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  LLM_PROVIDERS,
  STATIC_MODELS,
  TOOL_PROVIDERS,
  llmProviderName,
  modelLabel,
} from '../lib/providers.js';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';
import { ArrowLeft, Bot, Key, User } from './Icons.js';
import { LanguageSwitcher } from './LanguageSwitcher.js';

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
  const { t } = useTranslation();
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
      setSuccess(t('settings.saveSuccess'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>{t('settings.profileUsername')}</FieldLabel>
        <input
          type="text"
          value={user?.username ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-sm text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">{t('settings.profileUsernameHint')}</p>
      </div>
      <div>
        <FieldLabel>{t('settings.profileDid')}</FieldLabel>
        <input
          type="text"
          value={user?.did ?? ''}
          disabled
          className="w-full px-3 py-2 bg-dark-base border border-dark-border rounded-lg text-xs text-ink-muted font-mono opacity-60"
        />
        <p className="text-[11px] text-ink-muted mt-1">{t('settings.profileDidHint')}</p>
      </div>
      <div>
        <FieldLabel>{t('settings.profileDisplayName')}</FieldLabel>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('settings.profileDisplayNamePlaceholder')}
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.profileEmail')}</FieldLabel>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('settings.profileEmailPlaceholder')}
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.profilePhone')}</FieldLabel>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={t('settings.profilePhonePlaceholder')}
          className={INPUT_CN}
        />
      </div>

      <div>
        <FieldLabel>{t('language.label')}</FieldLabel>
        <LanguageSwitcher />
      </div>

      <StatusMsg error={error} success={success} />

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-500 disabled:opacity-40 transition-colors"
      >
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </div>
  );
}

function AgentTab() {
  const { t } = useTranslation();
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

  const modelOptions =
    dynamicModels.length > 0
      ? dynamicModels
      : (STATIC_MODELS[provider] ?? []).map((m) => ({ value: m.value, label: modelLabel(m, t) }));

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
        <FieldLabel>{t('settings.agentName')}</FieldLabel>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.agentNamePlaceholder')}
          className={INPUT_CN}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.agentDescription')}</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.agentDescriptionPlaceholder')}
          rows={2}
          className={`${INPUT_CN} resize-none`}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.agentProvider')}</FieldLabel>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className={SELECT_CN}
        >
          <option value="">{t('settings.agentProviderPlaceholder')}</option>
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {llmProviderName(p, t)}
            </option>
          ))}
        </select>
      </div>
      {provider && (
        <div>
          <FieldLabel>
            {t('settings.agentModel')}
            {loadingModels && (
              <span className="text-ink-muted font-normal ml-2 text-[11px]">
                {t('settings.agentModelLoading')}
              </span>
            )}
          </FieldLabel>
          {modelOptions.length > 0 ? (
            <select value={model} onChange={(e) => setModel(e.target.value)} className={SELECT_CN}>
              <option value="">{t('settings.agentModelPlaceholder')}</option>
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
                provider === 'ollama'
                  ? t('settings.agentModelOllamaInput')
                  : t('settings.agentModelInput')
              }
              className={INPUT_CN}
            />
          )}
        </div>
      )}
      <div>
        <FieldLabel>{t('settings.agentSystemPrompt')}</FieldLabel>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={t('settings.agentSystemPromptPlaceholder')}
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
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </div>
  );
}

function KeysTab() {
  const { t } = useTranslation();
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
      <p className="text-xs text-ink-muted leading-relaxed">{t('settings.keysIntro')}</p>

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
                  <span className="text-sm font-medium text-ink-primary">
                    {llmProviderName(provider, t)}
                  </span>
                  {provider.supportsEmbedding && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/30">
                      {t('settings.keysSupportsKb')}
                    </span>
                  )}
                  {isConfigured && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                      {t('settings.keysConfigured')}
                    </span>
                  )}
                  {isOllama && !isConfigured && (
                    <span className="text-[11px] text-ink-muted">
                      {t('settings.keysOllamaHint')}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => handleEdit(provider.id)}
                      className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                    >
                      {isConfigured ? t('common.update') : t('common.configure')}
                    </button>
                  )}
                  {isConfigured && !isEditing && (
                    <button
                      type="button"
                      onClick={() => removeLlmKey(provider.id)}
                      disabled={saving}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                    >
                      {t('common.remove')}
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
                    {t('common.save')}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="px-3 py-1.5 border border-dark-border rounded-lg text-xs text-ink-muted hover:text-ink-secondary transition-colors"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="pt-2">
        <p className="text-xs font-medium text-ink-secondary mb-2">
          {t('settings.keysToolServices')}
        </p>
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
                      <span className="text-sm font-medium text-ink-primary">
                        {t(tool.nameKey)}
                      </span>
                      {isConfigured && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
                          {t('settings.keysConfigured')}
                        </span>
                      )}
                      <p className="text-[11px] text-ink-muted mt-0.5">{t(tool.descriptionKey)}</p>
                    </div>
                  </div>
                  <div className="flex gap-3 shrink-0 ml-3">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => handleEdit(tool.id)}
                        className="text-xs text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        {isConfigured ? t('common.update') : t('common.configure')}
                      </button>
                    )}
                    {isConfigured && !isEditing && (
                      <button
                        type="button"
                        onClick={() => removeLlmKey(tool.id)}
                        disabled={saving}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                      >
                        {t('common.remove')}
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
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="px-3 py-1.5 border border-dark-border rounded-lg text-xs text-ink-muted hover:text-ink-secondary transition-colors"
                    >
                      {t('common.cancel')}
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
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('profile');
  const navigate = useNavigate();

  const tabs: { id: Tab; label: string; icon: typeof User }[] = [
    { id: 'profile', label: t('settings.tabProfile'), icon: User },
    { id: 'agent', label: t('settings.tabAgent'), icon: Bot },
    { id: 'keys', label: t('settings.tabKeys'), icon: Key },
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
        <h1 className="font-semibold text-sm text-ink-primary ml-2">{t('settings.title')}</h1>
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
              {tabs.find((item) => item.id === tab)?.label}
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
