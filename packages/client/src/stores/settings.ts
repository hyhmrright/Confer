import { create } from 'zustand';
import { api } from '../lib/api.js';

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
  is_public?: boolean;
}

interface AgentPatch {
  name?: string;
  description?: string;
  model_config_json?: ModelConfig;
}

interface LlmKeyEntry {
  provider: string;
  configured: boolean;
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
  loadLlmKeys: () => Promise<void>;
  saveLlmKey: (provider: string, apiKey: string) => Promise<void>;
  removeLlmKey: (provider: string) => Promise<void>;
  fetchModels: (provider: string) => Promise<{ value: string; label: string }[]>;
  clearMessages: () => void;
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

  updateAgent: async (patch) => {
    set({ saving: true, error: null, success: null });
    try {
      await api.patch('/agents/me', patch);
      set((s) => ({
        agent: s.agent ? { ...s.agent, ...patch } : s.agent,
        saving: false,
        success: '保存成功',
      }));
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '保存失败' });
    }
  },

  loadLlmKeys: async () => {
    try {
      const data = await api.get<{ keys: LlmKeyEntry[] }>('/agents/me/llm-keys');
      set({ llmKeys: data.keys });
    } catch {
      // ignore
    }
  },

  saveLlmKey: async (provider, apiKey) => {
    set({ saving: true, error: null, success: null });
    try {
      await api.put('/agents/me/llm-keys', { provider, api_key: apiKey });
      set((s) => ({
        saving: false,
        success: `${provider} 密钥已保存`,
        llmKeys: s.llmKeys.map((k) => (k.provider === provider ? { ...k, configured: true } : k)),
      }));
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '保存失败' });
    }
  },

  removeLlmKey: async (provider) => {
    set({ saving: true, error: null, success: null });
    try {
      await api.delete(`/agents/me/llm-keys/${provider}`);
      set((s) => ({
        saving: false,
        success: `${provider} 密钥已移除`,
        llmKeys: s.llmKeys.map((k) => (k.provider === provider ? { ...k, configured: false } : k)),
      }));
    } catch (e) {
      set({ saving: false, error: e instanceof Error ? e.message : '删除失败' });
    }
  },

  fetchModels: async (provider) => {
    try {
      const data = await api.get<{ models: { id: string }[] }>(
        `/agents/me/llm-keys/${provider}/models`,
      );
      return (data.models ?? []).map((m) => ({ value: m.id, label: m.id }));
    } catch {
      return [];
    }
  },

  clearMessages: () => {
    set({ error: null, success: null });
  },
}));
