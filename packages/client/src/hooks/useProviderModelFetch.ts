import { useCallback, useRef, useState } from 'react';
import type { ModelListError } from '../stores/settings.js';
import { useSettingsStore } from '../stores/settings.js';

export interface ProviderModelFetch {
  models: string[];
  loading: boolean;
  /** Set when the list came back empty; names which failure it was. */
  error: ModelListError | null;
  /**
   * Load a provider's available models from the vendor, via the gateway. Pass
   * an empty provider to reset.
   *
   * Ollama used to be special-cased here and probed straight from the browser
   * at a hardcoded `http://localhost:11434`. That reached a different machine
   * than the one the agent chats with (the gateway runs in a container, where
   * the owner's address is `host.docker.internal`), it ignored whatever address
   * the owner had actually configured, and the browser's own CORS rules blocked
   * it in the deployed build anyway. It now takes the same path as every other
   * provider, so the list can only succeed where a chat would.
   */
  load: (provider: string) => Promise<void>;
}

export function useProviderModelFetch(): ProviderModelFetch {
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ModelListError | null>(null);

  // Each call takes a ticket and only the newest one may write. Switching
  // providers twice in quick succession leaves two requests in flight against
  // different vendors, and they return in whatever order the network decides —
  // without this, the slower one wins and the field ends up offering another
  // vendor's models. The same applies to a double-click on Refresh.
  const latestRequest = useRef(0);

  // Stable so callers can drive it from an effect without re-running on render.
  const load = useCallback(
    async (provider: string) => {
      const ticket = ++latestRequest.current;
      setModels([]);
      setError(null);
      if (!provider) return;

      setLoading(true);
      try {
        const result = await fetchModels(provider);
        if (ticket !== latestRequest.current) return;
        setModels(result.models);
        setError(result.error ?? null);
      } finally {
        if (ticket === latestRequest.current) setLoading(false);
      }
    },
    [fetchModels],
  );

  return { models, loading, error, load };
}
