import type { PolicyOverrides } from '@confer/shared';
import { create, type StoreApi } from 'zustand';
import i18n from '../i18n/index.js';
import { api } from '../lib/api.js';
import { captureError } from '../lib/error.js';

interface ModelConfig {
  provider?: string;
  model?: string;
  system_prompt?: string;
}

interface AgentConfig {
  id?: string;
  name?: string;
  description?: string;
  model_config_json?: ModelConfig;
  // Agent-level default policy (DB column `agents.policies_json`). Engine
  // vocabulary (`{ default?, rules? }` with `allow`/`ask_user`/`deny`) — the
  // same shared shape as a per-contact override.
  policies_json?: PolicyOverrides;
  is_public?: boolean;
}

interface AgentPatch {
  name?: string;
  description?: string;
  is_public?: boolean;
  model_config_json?: ModelConfig;
}

interface LlmKeyEntry {
  provider: string;
  configured: boolean;
}

/**
 * Why a provider's model list came back empty. The gateway distinguishes these
 * so the settings UI can tell the owner what to do about it — an empty list on
 * its own reads as "this provider has no models", which was never true.
 */
export type ModelListError = 'no_key' | 'unsupported' | 'unauthorized' | 'unreachable';

export interface ModelList {
  models: string[];
  error?: ModelListError;
}

interface ModelListResponse {
  models?: { id: string }[];
  error?: ModelListError;
}

interface SettingsState {
  agent: AgentConfig | null;
  llmKeys: LlmKeyEntry[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;

  loadAgent: () => Promise<void>;
  updateAgent: (patch: AgentPatch) => Promise<void>;
  updatePolicies: (policies: PolicyOverrides) => Promise<void>;
  loadLlmKeys: () => Promise<void>;
  saveLlmKey: (provider: string, apiKey: string) => Promise<void>;
  removeLlmKey: (provider: string) => Promise<void>;
  fetchModels: (provider: string) => Promise<ModelList>;
  clearMessages: () => void;
}

type SetSettings = StoreApi<SettingsState>['setState'];

// The shape every settings write shares: clear the banners and raise `saving`,
// run the request, then either apply its patch or report the failure.
async function save(
  set: SetSettings,
  request: () => Promise<unknown>,
  onSuccess: (s: SettingsState) => Partial<SettingsState>,
  failureKey: 'settings.saveFailed' | 'settings.deleteFailed',
): Promise<void> {
  set({ saving: true, error: null, success: null });
  try {
    await request();
    set((s) => ({ ...onSuccess(s), saving: false }));
  } catch (e) {
    set({ saving: false, error: captureError(e, i18n.t(failureKey)) });
  }
}

function setConfigured(keys: LlmKeyEntry[], provider: string, configured: boolean) {
  return keys.map((k) => (k.provider === provider ? { ...k, configured } : k));
}

export const useSettingsStore = create<SettingsState>((set) => ({
  agent: null,
  llmKeys: [],
  loading: false,
  saving: false,
  error: null,
  success: null,

  loadAgent: async () => {
    set({ loading: true });
    try {
      const data = await api.get<{ agent: AgentConfig }>('/agents/me');
      set({ agent: data.agent ?? null, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  updateAgent: (patch) =>
    save(
      set,
      () => api.patch('/agents/me', patch),
      (s) => ({
        agent: s.agent ? { ...s.agent, ...patch } : s.agent,
        success: i18n.t('settings.saveSuccess'),
      }),
      'settings.saveFailed',
    ),

  updatePolicies: (policies) =>
    save(
      set,
      // Whole-object replace. The server stores the body verbatim
      // (`z.record(z.string(), z.unknown())`), so the client is the only guard that the
      // shape is the correct engine vocabulary — hence the `PolicyOverrides` type.
      () => api.put('/agents/me/policies', policies),
      (s) => ({
        agent: s.agent ? { ...s.agent, policies_json: policies } : s.agent,
        success: i18n.t('settings.saveSuccess'),
      }),
      'settings.saveFailed',
    ),

  loadLlmKeys: async () => {
    try {
      const data = await api.get<{ keys: LlmKeyEntry[] }>('/agents/me/llm-keys');
      set({ llmKeys: data.keys });
    } catch {
      // ignore
    }
  },

  saveLlmKey: (provider, apiKey) =>
    save(
      set,
      () => api.put('/agents/me/llm-keys', { provider, api_key: apiKey }),
      (s) => ({
        success: i18n.t('settings.keySaved', { provider }),
        llmKeys: setConfigured(s.llmKeys, provider, true),
      }),
      'settings.saveFailed',
    ),

  removeLlmKey: (provider) =>
    save(
      set,
      () => api.delete(`/agents/me/llm-keys/${provider}`),
      (s) => ({
        success: i18n.t('settings.keyRemoved', { provider }),
        llmKeys: setConfigured(s.llmKeys, provider, false),
      }),
      'settings.deleteFailed',
    ),

  fetchModels: async (provider) => {
    try {
      const data = await api.get<ModelListResponse>(`/agents/me/llm-keys/${provider}/models`);
      return { models: (data.models ?? []).map((m) => m.id), error: data.error };
    } catch {
      // The gateway itself is unreachable, which is a different failure from
      // the vendor being unreachable but reads the same to the owner.
      return { models: [], error: 'unreachable' };
    }
  },

  clearMessages: () => {
    set({ error: null, success: null });
  },
}));
