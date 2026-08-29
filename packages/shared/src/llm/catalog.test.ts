import { describe, expect, test } from 'bun:test';
import { LLM_PROVIDER_IDS, LLM_PROVIDERS, llmProvider, providerBaseUrl } from './catalog.js';

describe('catalogue shape', () => {
  test('ids are unique', () => {
    expect(new Set(LLM_PROVIDER_IDS).size).toBe(LLM_PROVIDERS.length);
  });

  // The gateway joins base + path by concatenation, so a missing or doubled
  // slash produces a URL that 404s at a vendor nobody will think to check.
  test('base URLs are absolute and unterminated, paths are rooted', () => {
    for (const spec of LLM_PROVIDERS) {
      expect(spec.baseUrl).toMatch(/^https?:\/\//);
      expect(spec.baseUrl.endsWith('/')).toBe(false);
      expect(spec.completionsPath.startsWith('/')).toBe(true);
      if (spec.modelsPath) expect(spec.modelsPath.startsWith('/')).toBe(true);
    }
  });

  // Anthropic is the one vendor not speaking OpenAI's wire shape. If a second
  // ever appears, `createProvider` and the gateway's model listing both need a
  // branch for it — this is the reminder.
  test('anthropic is the only non-OpenAI shape', () => {
    expect(LLM_PROVIDERS.filter((p) => p.kind === 'anthropic').map((p) => p.id)).toEqual([
      'anthropic',
    ]);
  });
});

describe('providerBaseUrl', () => {
  test('uses the catalogue address for hosted vendors, ignoring the key', () => {
    const openai = llmProvider('openai');
    expect(openai).toBeDefined();
    if (openai) expect(providerBaseUrl(openai, 'sk-secret')).toBe('https://api.openai.com');
  });

  test('lets a local runtime override the address with its stored value', () => {
    const ollama = llmProvider('ollama');
    expect(ollama).toBeDefined();
    if (!ollama) return;
    expect(providerBaseUrl(ollama)).toBe('http://localhost:11434');
    expect(providerBaseUrl(ollama, 'http://host.docker.internal:11434/')).toBe(
      'http://host.docker.internal:11434',
    );
  });
});
