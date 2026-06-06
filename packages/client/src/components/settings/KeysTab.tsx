import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LLM_PROVIDERS, TOOL_PROVIDERS, llmProviderName } from '../../lib/providers.js';
import { useSettingsStore } from '../../stores/settings.js';
import { ProviderKeyEditor } from './ProviderKeyEditor.js';
import { StatusMsg } from './SettingsShared.js';

export function KeysTab() {
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
    setKeyValue(providerId === 'ollama' ? 'http://localhost:11434' : '');
  };

  const isConfigured = (id: string) => llmKeys.find((k) => k.provider === id)?.configured ?? false;

  const configuredBadge = (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-800/30">
      {t('settings.keysConfigured')}
    </span>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-muted leading-relaxed">{t('settings.keysIntro')}</p>

      <StatusMsg error={error} success={success} />

      <div className="space-y-2">
        {LLM_PROVIDERS.map((provider) => {
          const configured = isConfigured(provider.id);
          const isOllama = provider.id === 'ollama';
          return (
            <ProviderKeyEditor
              key={provider.id}
              name={llmProviderName(provider, t)}
              configured={configured}
              editing={editing === provider.id}
              saving={saving}
              inputType={isOllama ? 'text' : 'password'}
              inputPlaceholder={isOllama ? 'http://localhost:11434' : 'sk-...'}
              keyValue={keyValue}
              badge={
                <>
                  {provider.supportsEmbedding && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/30 text-blue-400 border border-blue-800/30">
                      {t('settings.keysSupportsKb')}
                    </span>
                  )}
                  {configured && configuredBadge}
                </>
              }
              hint={
                isOllama && !configured ? (
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
        })}
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
