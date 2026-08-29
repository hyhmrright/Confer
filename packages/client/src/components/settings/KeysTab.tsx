import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LLM_PROVIDERS, llmProviderName, TOOL_PROVIDERS } from '../../lib/providers.js';
import { useSettingsStore } from '../../stores/settings.js';
import { ProviderKeyEditor } from './ProviderKeyEditor.js';
import { StatusMsg } from './SettingsShared.js';

// Address suggested for a local model runtime. Not `localhost`: the gateway is
// what dials it, and inside its container localhost is the container. This name
// is the owner's own machine from there — Docker Desktop provides it, and
// compose maps it explicitly for Linux.
const OLLAMA_ADDRESS = 'http://host.docker.internal:11434';

export function KeysTab() {
  const { t } = useTranslation();
  const llmKeys = useSettingsStore((s) => s.llmKeys);
  const saving = useSettingsStore((s) => s.saving);
  const error = useSettingsStore((s) => s.error);
  const success = useSettingsStore((s) => s.success);
  const loadLlmKeys = useSettingsStore((s) => s.loadLlmKeys);
  const saveLlmKey = useSettingsStore((s) => s.saveLlmKey);
  const removeLlmKey = useSettingsStore((s) => s.removeLlmKey);
  const clearMessages = useSettingsStore((s) => s.clearMessages);
  const [editing, setEditing] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState('');

  useEffect(() => {
    loadLlmKeys();
  }, [loadLlmKeys]);

  useEffect(() => {
    if (success || error) {
      const timer = setTimeout(clearMessages, 3000);
      return () => clearTimeout(timer);
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
    const provider = LLM_PROVIDERS.find((p) => p.id === providerId);
    setKeyValue(provider?.keyIsBaseUrl ? OLLAMA_ADDRESS : '');
  };

  const isConfigured = (id: string) => llmKeys.find((k) => k.provider === id)?.configured ?? false;

  const configuredBadge = (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
      {t('settings.keysConfigured')}
    </span>
  );

  // The catalogue is long enough now that the two or three providers the owner
  // actually pays for would otherwise be scattered through a list of vendors
  // they have never used. Grouping keeps their own set at the top without
  // reordering the rest, which stays in the catalogue's own order.
  const configuredProviders = LLM_PROVIDERS.filter((p) => isConfigured(p.id));
  const availableProviders = LLM_PROVIDERS.filter((p) => !isConfigured(p.id));
  const grouped = configuredProviders.length > 0;

  const renderProvider = (provider: (typeof LLM_PROVIDERS)[number]) => {
    const configured = isConfigured(provider.id);
    const addressOnly = provider.keyIsBaseUrl;
    return (
      <ProviderKeyEditor
        key={provider.id}
        name={llmProviderName(provider, t)}
        configured={configured}
        editing={editing === provider.id}
        saving={saving}
        inputType={addressOnly ? 'text' : 'password'}
        inputPlaceholder={addressOnly ? OLLAMA_ADDRESS : 'sk-...'}
        keyValue={keyValue}
        badge={
          <>
            {/* Neutral, not blue. This says the provider can also do
                embeddings — a capability, not a status — and blue is the
                one hue with no meaning anywhere else in the palette, so
                it read as a state the reader had to decode. */}
            {provider.supportsEmbedding && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-dark-border text-ink-secondary border border-dark-active">
                {t('settings.keysSupportsKb')}
              </span>
            )}
            {configured && configuredBadge}
          </>
        }
        hint={
          addressOnly && !configured ? (
            <span className="text-[11px] text-ink-muted">{t('settings.keysOllamaHint')}</span>
          ) : undefined
        }
        onEdit={() => handleEdit(provider.id)}
        onRemove={() => removeLlmKey(provider.id)}
        onChange={setKeyValue}
        onSave={() => handleSave(provider.id)}
        onCancel={cancelEdit}
      />
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted leading-relaxed">{t('settings.keysIntro')}</p>

      <StatusMsg error={error} success={success} />

      {/* Headings only earn their place once there are two groups to tell
          apart: before the owner configures anything, the whole catalogue is
          one undifferentiated list and naming it says nothing. */}
      {grouped && (
        <div>
          <p className="text-xs font-medium text-ink-secondary mb-2">
            {t('settings.keysConfiguredGroup')}
          </p>
          <div className="space-y-2">{configuredProviders.map(renderProvider)}</div>
        </div>
      )}

      <div>
        {grouped && (
          <p className="text-xs font-medium text-ink-secondary mb-2">
            {t('settings.keysAvailableGroup')}
          </p>
        )}
        <div className="space-y-2">{availableProviders.map(renderProvider)}</div>
      </div>

      <div className="pt-2">
        <p className="text-xs font-medium text-ink-secondary mb-2">
          {t('settings.keysToolServices')}
        </p>
        <div className="space-y-2">
          {TOOL_PROVIDERS.map((tool) => {
            const configured = isConfigured(tool.id);
            return (
              <ProviderKeyEditor
                key={tool.id}
                name={t(tool.nameKey)}
                configured={configured}
                editing={editing === tool.id}
                saving={saving}
                inputType="password"
                inputPlaceholder={tool.placeholder}
                keyValue={keyValue}
                badge={configured ? <span className="ml-2">{configuredBadge}</span> : undefined}
                description={t(tool.descriptionKey)}
                onEdit={() => handleEdit(tool.id)}
                onRemove={() => removeLlmKey(tool.id)}
                onChange={setKeyValue}
                onSave={() => handleSave(tool.id)}
                onCancel={cancelEdit}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
