import { useState } from 'react';
import { useSettingsStore } from '../stores/settings.js';

interface ModelOption {
  value: string;
  label: string;
}

export interface ProviderModelFetch {
  dynamicModels: ModelOption[];
  loadingModels: boolean;
  // Fetch the available models for a provider into `dynamicModels`. Ollama is
  // probed directly on its local HTTP endpoint; everything else goes through the
  // settings store (which proxies to the gateway). Best-effort: clears the list
  // on any failure. Pass an empty provider to reset.
  fetchForProvider: (provider: string) => Promise<void>;
  reset: () => void;
}

export function useProviderModelFetch(): ProviderModelFetch {
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const [dynamicModels, setDynamicModels] = useState<ModelOption[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const fetchForProvider = async (provider: string) => {
    setDynamicModels([]);
    if (!provider) return;

    setLoadingModels(true);
    try {
      if (provider === 'ollama') {
        const resp = await fetch('http://localhost:11434/api/tags');
        const data = (await resp.json()) as { models?: { name: string }[] };
        setDynamicModels((data.models ?? []).map((m) => ({ value: m.name, label: m.name })));
      } else {
        setDynamicModels(await fetchModels(provider));
      }
    } catch {
      setDynamicModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  return {
    dynamicModels,
    loadingModels,
    fetchForProvider,
    reset: () => setDynamicModels([]),
  };
}
