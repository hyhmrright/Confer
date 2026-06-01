import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock the HTTP layer so store logic is tested without a real backend.
const get = mock(async (_path: string) => ({}) as unknown);
const post = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const patch = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const put = mock(async (_path: string, _body: unknown) => ({}) as unknown);
const del = mock(async (_path: string) => ({}) as unknown);
mock.module('../lib/api.js', () => ({
  api: { get, post, patch, put, delete: del },
  setToken: mock(() => {}),
  setRefreshToken: mock(() => {}),
  getToken: mock(() => null),
}));

const { default: i18n } = await import('../i18n/index.js');
const { useSettingsStore } = await import('./settings.js');

const initial = useSettingsStore.getState();

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  put.mockReset();
  del.mockReset();
  useSettingsStore.setState({
    agent: null,
    llmKeys: [],
    loading: false,
    saving: false,
    error: null,
    success: null,
  });
});

afterEach(() => {
  useSettingsStore.setState(initial, true);
});

describe('settings store', () => {
  test('loadAgent stores the agent and clears loading', async () => {
    const agent = { id: 'a1', name: 'Bot' };
    get.mockResolvedValueOnce({ agent });
    await useSettingsStore.getState().loadAgent();
    expect(get).toHaveBeenCalledWith('/agents/me');
    const state = useSettingsStore.getState();
    expect(state.agent).toEqual(agent as never);
    expect(state.loading).toBe(false);
  });

  test('loadAgent clears loading on error without throwing', async () => {
    get.mockRejectedValueOnce(new Error('nope'));
    await useSettingsStore.getState().loadAgent();
    const state = useSettingsStore.getState();
    expect(state.agent).toBeNull();
    expect(state.loading).toBe(false);
  });

  test('updateAgent patches, merges into agent, and sets success', async () => {
    useSettingsStore.setState({ agent: { id: 'a1', name: 'Old' } as never });
    patch.mockResolvedValueOnce({});
    await useSettingsStore.getState().updateAgent({ name: 'New' });
    expect(patch).toHaveBeenCalledWith('/agents/me', { name: 'New' });
    const state = useSettingsStore.getState();
    expect(state.agent?.name).toBe('New');
    expect(state.saving).toBe(false);
    expect(state.success).toBe(i18n.t('settings.saveSuccess'));
    expect(state.error).toBeNull();
  });

  test('updateAgent surfaces the error on failure', async () => {
    patch.mockRejectedValueOnce(new Error('patch failed'));
    await useSettingsStore.getState().updateAgent({ name: 'New' });
    const state = useSettingsStore.getState();
    expect(state.saving).toBe(false);
    expect(state.error).toBe('patch failed');
    expect(state.success).toBeNull();
  });

  test('loadLlmKeys stores the key list', async () => {
    const keys = [{ provider: 'openai', configured: true }];
    get.mockResolvedValueOnce({ keys });
    await useSettingsStore.getState().loadLlmKeys();
    expect(get).toHaveBeenCalledWith('/agents/me/llm-keys');
    expect(useSettingsStore.getState().llmKeys).toEqual(keys as never);
  });

  test('loadLlmKeys swallows errors and leaves keys unchanged', async () => {
    useSettingsStore.setState({ llmKeys: [{ provider: 'glm', configured: false }] });
    get.mockRejectedValueOnce(new Error('boom'));
    await useSettingsStore.getState().loadLlmKeys();
    expect(useSettingsStore.getState().llmKeys).toEqual([{ provider: 'glm', configured: false }]);
  });

  test('saveLlmKey puts the key and marks the provider configured', async () => {
    useSettingsStore.setState({
      llmKeys: [
        { provider: 'openai', configured: false },
        { provider: 'glm', configured: false },
      ],
    });
    put.mockResolvedValueOnce({});
    await useSettingsStore.getState().saveLlmKey('openai', 'sk-secret');
    expect(put).toHaveBeenCalledWith('/agents/me/llm-keys', {
      provider: 'openai',
      api_key: 'sk-secret',
    });
    const state = useSettingsStore.getState();
    expect(state.saving).toBe(false);
    expect(state.success).toBe(i18n.t('settings.keySaved', { provider: 'openai' }));
    expect(state.llmKeys).toEqual([
      { provider: 'openai', configured: true },
      { provider: 'glm', configured: false },
    ]);
  });

  test('saveLlmKey surfaces the error on failure', async () => {
    put.mockRejectedValueOnce(new Error('save failed'));
    await useSettingsStore.getState().saveLlmKey('openai', 'sk-secret');
    const state = useSettingsStore.getState();
    expect(state.saving).toBe(false);
    expect(state.error).toBe('save failed');
  });

  test('removeLlmKey deletes the key and marks the provider unconfigured', async () => {
    useSettingsStore.setState({
      llmKeys: [
        { provider: 'openai', configured: true },
        { provider: 'glm', configured: true },
      ],
    });
    del.mockResolvedValueOnce({});
    await useSettingsStore.getState().removeLlmKey('openai');
    expect(del).toHaveBeenCalledWith('/agents/me/llm-keys/openai');
    const state = useSettingsStore.getState();
    expect(state.saving).toBe(false);
    expect(state.success).toBe(i18n.t('settings.keyRemoved', { provider: 'openai' }));
    expect(state.llmKeys).toEqual([
      { provider: 'openai', configured: false },
      { provider: 'glm', configured: true },
    ]);
  });

  test('removeLlmKey surfaces the error on failure', async () => {
    del.mockRejectedValueOnce(new Error('delete failed'));
    await useSettingsStore.getState().removeLlmKey('openai');
    const state = useSettingsStore.getState();
    expect(state.saving).toBe(false);
    expect(state.error).toBe('delete failed');
  });

  test('fetchModels maps model ids into value/label options', async () => {
    get.mockResolvedValueOnce({ models: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] });
    const result = await useSettingsStore.getState().fetchModels('openai');
    expect(get).toHaveBeenCalledWith('/agents/me/llm-keys/openai/models');
    expect(result).toEqual([
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ]);
  });

  test('fetchModels returns an empty list on error', async () => {
    get.mockRejectedValueOnce(new Error('boom'));
    const result = await useSettingsStore.getState().fetchModels('openai');
    expect(result).toEqual([]);
  });

  test('clearMessages resets error and success', () => {
    useSettingsStore.setState({ error: 'oops', success: 'done' });
    useSettingsStore.getState().clearMessages();
    const state = useSettingsStore.getState();
    expect(state.error).toBeNull();
    expect(state.success).toBeNull();
  });
});
