import { describe, expect, test } from 'bun:test';
import { createProvider, getProvider, registerProvider } from './registry.js';

describe('createProvider', () => {
  test('routes each known provider name to an instance', () => {
    for (const name of ['anthropic', 'openai', 'deepseek', 'qwen', 'glm', 'ollama']) {
      expect(createProvider(name, 'test-key')).not.toBeNull();
    }
  });

  test('names the anthropic provider correctly', () => {
    expect(createProvider('anthropic', 'test-key')?.name).toBe('anthropic');
  });

  test('allows ollama without an api key', () => {
    expect(createProvider('ollama', '')).not.toBeNull();
  });

  test('returns null for an unknown provider name', () => {
    expect(createProvider('does-not-exist', 'test-key')).toBeNull();
  });
});

describe('registerProvider / getProvider', () => {
  test('stores and retrieves a provider by name', () => {
    const provider = createProvider('anthropic', 'test-key');
    expect(provider).not.toBeNull();
    if (provider) {
      registerProvider(provider);
      expect(getProvider('anthropic')).toBe(provider);
    }
  });

  test('returns undefined for an unregistered name', () => {
    expect(getProvider('never-registered')).toBeUndefined();
  });
});
