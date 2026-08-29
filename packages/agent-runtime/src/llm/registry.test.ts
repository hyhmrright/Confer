import { describe, expect, test } from 'bun:test';
import { LLM_PROVIDERS } from '@confer/shared';
import { createProvider, getProvider, registerProvider } from './registry.js';

// Reach into the built provider for the wire settings it was constructed with.
// They are private because nothing in production reads them; the point of these
// assertions is that the catalogue entry survives the trip.
function wire(provider: unknown) {
  return provider as {
    name: string;
    baseUrl: string;
    defaultModel: string;
    completionsPath: string;
  };
}

describe('createProvider', () => {
  test('builds every catalogued provider', () => {
    for (const spec of LLM_PROVIDERS) {
      expect(createProvider(spec.id, 'test-key')).not.toBeNull();
    }
  });

  test('carries the catalogue base URL, path and default model onto the provider', () => {
    // One per shape: a vendor on the default paths, one whose base already
    // carries its version prefix so the completions path is shorter, and one
    // catalogued without a default model.
    expect(wire(createProvider('deepseek', 'k'))).toMatchObject({
      name: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      completionsPath: '/v1/chat/completions',
      defaultModel: 'deepseek-chat',
    });
    expect(wire(createProvider('glm', 'k'))).toMatchObject({
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      completionsPath: '/chat/completions',
    });
    expect(wire(createProvider('xai', 'k')).defaultModel).toBe('');
  });

  test('names the anthropic provider correctly', () => {
    expect(createProvider('anthropic', 'test-key')?.name).toBe('anthropic');
  });

  test('allows ollama without an api key', () => {
    expect(createProvider('ollama', '')).not.toBeNull();
    expect(wire(createProvider('ollama', '')).baseUrl).toBe('http://localhost:11434');
  });

  test("treats ollama's stored key as its address, not a credential", () => {
    const provider = createProvider('ollama', 'http://host.docker.internal:11434/');
    // Trailing slash dropped so joining the completions path cannot double it.
    expect(wire(provider).baseUrl).toBe('http://host.docker.internal:11434');
    expect((provider as unknown as { apiKey: string }).apiKey).toBe('');
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
