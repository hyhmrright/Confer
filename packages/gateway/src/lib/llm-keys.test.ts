import { describe, expect, test } from 'bun:test';
import { type EncryptedValue, encrypt } from '@confer/shared';
import { decryptUserKey, resolveEmbeddingKey } from './llm-keys.js';

// Two distinct valid 32-byte (64 hex char) AES keys.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

async function enc(plaintext: string, key = KEY): Promise<EncryptedValue> {
  const result = await encrypt(plaintext, key);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('decryptUserKey', () => {
  test('returns the plaintext for a key that decrypts', async () => {
    const llmKeys = { openai: await enc('sk-openai') };
    expect(await decryptUserKey(llmKeys, 'openai', KEY)).toBe('sk-openai');
  });

  test('returns empty string when the named key is absent', async () => {
    expect(await decryptUserKey({}, 'openai', KEY)).toBe('');
  });

  test('returns empty string when the value cannot be decrypted (wrong key)', async () => {
    const llmKeys = { openai: await enc('sk-openai', OTHER_KEY) };
    expect(await decryptUserKey(llmKeys, 'openai', KEY)).toBe('');
  });
});

describe('resolveEmbeddingKey', () => {
  test('returns null when no embedding provider key is configured', async () => {
    expect(await resolveEmbeddingKey({}, KEY)).toBeNull();
  });

  test('prefers the highest-priority provider (openai before glm)', async () => {
    const llmKeys = { glm: await enc('glm-key'), openai: await enc('openai-key') };
    expect(await resolveEmbeddingKey(llmKeys, KEY)).toEqual({
      apiKey: 'openai-key',
      provider: 'openai',
    });
  });

  // A fully local install has no hosted key at all. Before Ollama joined the
  // priority list this returned null, which disabled the knowledge base and
  // memory recall outright — the one thing the local path could not do.
  test('falls back to the local Ollama base URL when no hosted key exists', async () => {
    const llmKeys = { ollama: await enc('http://host.docker.internal:11434') };
    expect(await resolveEmbeddingKey(llmKeys, KEY)).toEqual({
      apiKey: 'http://host.docker.internal:11434',
      provider: 'ollama',
    });
  });

  // ...but only as a fallback: an owner running a local chat model alongside a
  // hosted embedding key keeps the hosted one, so their existing vectors stay
  // comparable to the new ones.
  test('prefers a hosted key over Ollama', async () => {
    const llmKeys = { ollama: await enc('http://localhost:11434'), glm: await enc('glm-key') };
    expect(await resolveEmbeddingKey(llmKeys, KEY)).toEqual({
      apiKey: 'glm-key',
      provider: 'glm',
    });
  });

  test('skips a provider whose key fails to decrypt and falls through', async () => {
    const llmKeys = {
      openai: await enc('openai-key', OTHER_KEY), // undecryptable with KEY
      glm: await enc('glm-key'),
    };
    expect(await resolveEmbeddingKey(llmKeys, KEY)).toEqual({
      apiKey: 'glm-key',
      provider: 'glm',
    });
  });
});
