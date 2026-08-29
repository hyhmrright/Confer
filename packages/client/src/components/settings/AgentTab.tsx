import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderModelFetch } from '../../hooks/useProviderModelFetch.js';
import type { TranslationKey } from '../../i18n/index.js';
import { LLM_PROVIDERS, llmProviderName } from '../../lib/providers.js';
import { FOCUS_RING, INPUT_FIELD_CLS, SELECT_FIELD_CLS } from '../../lib/styles.js';
import type { ModelListError } from '../../stores/settings.js';
import { useSettingsStore } from '../../stores/settings.js';
import { LoadingDots } from '../LoadingDots.js';
import { SaveButton } from '../SaveButton.js';
import { FieldLabel, StatusMsg } from './SettingsShared.js';

// What to tell the owner when a provider's model list comes back empty. Each of
// these has a different thing to do about it, which is why the gateway reports
// which one happened instead of returning a bare empty list.
const MODEL_ERROR_TEXT: Record<ModelListError, TranslationKey> = {
  no_key: 'settings.agentModelNoKey',
  unauthorized: 'settings.agentModelUnauthorized',
  unreachable: 'settings.agentModelUnreachable',
  unsupported: 'settings.agentModelUnsupported',
};

/*
  One line under the model field saying where its suggestions came from.

  Worth its own component because it is the only place the owner learns that the
  list is the vendor's own answer rather than something the app made up, and
  because each failure needs a different next step from them. It replaces a bare
  "loading" flicker that said nothing once it stopped.
*/
function ModelListStatus({
  loading,
  error,
  count,
  provider,
  retiredModel,
  onRefresh,
}: {
  loading: boolean;
  error: ModelListError | null;
  count: number;
  provider: string;
  /** The model in use when the vendor's list no longer offers it. */
  retiredModel: string | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  let message: string;
  if (loading) {
    message = t('settings.agentModelLoading', { provider });
  } else if (error) {
    message = t(MODEL_ERROR_TEXT[error], { provider });
  } else {
    message = t('settings.agentModelCount', { provider, count });
  }

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-baseline gap-2">
        <p className="text-[11px] leading-relaxed text-ink-muted">{message}</p>
        {!loading && (
          <button
            type="button"
            onClick={onRefresh}
            className={`shrink-0 text-[11px] text-primary-400 transition-colors hover:text-primary-300 ${FOCUS_RING} rounded-sm`}
          >
            {t('settings.agentModelRefresh')}
          </button>
        )}
      </div>
      {retiredModel && (
        <p className="text-[11px] leading-relaxed text-yellow-400">
          {t('settings.agentModelNotListed', { provider, model: retiredModel })}
        </p>
      )}
    </div>
  );
}

export function AgentTab() {
  const { t } = useTranslation();
  const agent = useSettingsStore((s) => s.agent);
  const loading = useSettingsStore((s) => s.loading);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);
  const success = useSettingsStore((s) => s.success);
  const loadAgent = useSettingsStore((s) => s.loadAgent);
  const updateAgent = useSettingsStore((s) => s.updateAgent);
  const clearMessages = useSettingsStore((s) => s.clearMessages);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const {
    models,
    loading: loadingModels,
    error: modelError,
    load: loadModels,
  } = useProviderModelFetch();

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  // Load the vendor's model list whenever a provider is in play — including on
  // arrival, which is the case that was missing. The fetch used to hang off the
  // provider dropdown's onChange alone, so opening this tab on a saved provider
  // never asked the vendor anything: the list stayed empty and the field fell
  // back to a hardcoded catalogue of model names.
  useEffect(() => {
    void loadModels(provider);
  }, [provider, loadModels]);

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

  const providerLabel = LLM_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  // Worth flagging when the vendor no longer lists the model in use — that is
  // how a retired ID stays selected and silently 404s at chat time. Only
  // meaningful once a list actually arrived.
  const retiredModel = model && models.length > 0 && !models.includes(model) ? model : null;

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
        <LoadingDots />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel htmlFor="agent-name">{t('settings.agentName')}</FieldLabel>
        <input
          id="agent-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.agentNamePlaceholder')}
          className={INPUT_FIELD_CLS}
        />
      </div>
      <div>
        <FieldLabel htmlFor="agent-description">{t('settings.agentDescription')}</FieldLabel>
        <textarea
          id="agent-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('settings.agentDescriptionPlaceholder')}
          rows={2}
          className={`${INPUT_FIELD_CLS} resize-none`}
        />
      </div>
      <div>
        <FieldLabel htmlFor="agent-provider">{t('settings.agentProvider')}</FieldLabel>
        <select
          id="agent-provider"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel('');
          }}
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
          <FieldLabel htmlFor="agent-model">{t('settings.agentModel')}</FieldLabel>
          {/* One combobox rather than a select-or-input pair. A select cannot
              show a value it has no option for, so the model already in use
              rendered as an empty field whenever the vendor's list was missing
              or had moved on — the owner could not see what their agent was
              running. This shows the value either way, offers the vendor's list
              as suggestions, and stays usable at OpenRouter's several hundred
              entries, where a dropdown is not. */}
          <input
            id="agent-model"
            type="text"
            list="agent-model-options"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t('settings.agentModelPlaceholder')}
            className={`${INPUT_FIELD_CLS} font-mono`}
          />
          <datalist id="agent-model-options">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <ModelListStatus
            loading={loadingModels}
            error={modelError}
            count={models.length}
            provider={providerLabel}
            retiredModel={retiredModel}
            onRefresh={() => void loadModels(provider)}
          />
        </div>
      )}
      <div>
        <FieldLabel htmlFor="agent-system-prompt">{t('settings.agentSystemPrompt')}</FieldLabel>
        <textarea
          id="agent-system-prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder={t('settings.agentSystemPromptPlaceholder')}
          rows={5}
          className={`${INPUT_FIELD_CLS} resize-none font-mono text-xs`}
        />
      </div>

      <StatusMsg error={error} success={success} />

      <SaveButton onClick={handleSave} saving={saving} />
    </div>
  );
}
