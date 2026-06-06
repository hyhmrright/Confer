import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderModelFetch } from '../../hooks/useProviderModelFetch.js';
import { LLM_PROVIDERS, STATIC_MODELS, llmProviderName, modelLabel } from '../../lib/providers.js';
import { INPUT_FIELD_CLS, SELECT_FIELD_CLS } from '../../lib/styles.js';
import { useSettingsStore } from '../../stores/settings.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

export function AgentTab() {
  const { t } = useTranslation();
  const { agent, loading, saving, error, success, loadAgent, updateAgent, clearMessages } =
    useSettingsStore();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const { dynamicModels, loadingModels, fetchForProvider } = useProviderModelFetch();

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
      const timer = setTimeout(clearMessages, 3000);
      return () => clearTimeout(timer);
    }
  }, [success, error, clearMessages]);

  const handleProviderChange = (p: string) => {
    setProvider(p);
    setModel('');
    void fetchForProvider(p);
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
          className={INPUT_FIELD_CLS}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.agentDescription')}</FieldLabel>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.agentDescriptionPlaceholder')}
          rows={2}
          className={`${INPUT_FIELD_CLS} resize-none`}
        />
      </div>
      <div>
        <FieldLabel>{t('settings.agentProvider')}</FieldLabel>
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className={SELECT_FIELD_CLS}
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
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={SELECT_FIELD_CLS}
            >
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
              className={INPUT_FIELD_CLS}
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
          className={`${INPUT_FIELD_CLS} resize-none font-mono text-xs`}
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
