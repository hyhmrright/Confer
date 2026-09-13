import { describe, expect, test } from 'bun:test';
import { assertDialableRuntimeUrl, isRuntimeBaseUrl } from './runtime-url.js';

describe('isRuntimeBaseUrl', () => {
  test('accepts the addresses a local runtime is actually reached at', () => {
    for (const value of [
      'http://host.docker.internal:11434',
      'http://host.docker.internal:11434/',
      'http://127.0.0.1:1234/v1',
      'https://ollama.lan',
    ]) {
      expect(isRuntimeBaseUrl(value)).toBe(true);
    }
  });

  // Every dialer appends a path; each of these would let the stored value
  // choose it instead, or is not an address at all.
  test('refuses anything that would swallow the appended path', () => {
    for (const value of [
      'http://qdrant:6333/collections/x/snapshots?',
      'http://qdrant:6333/collections/x/snapshots?a=b',
      'http://host.docker.internal:11434#',
      'http://user:pw@host.docker.internal:11434',
      'file:///etc/passwd',
      'not-a-url',
    ]) {
      expect(isRuntimeBaseUrl(value)).toBe(false);
    }
  });
});

describe('assertDialableRuntimeUrl', () => {
  test('admits loopback and LAN, refuses link-local and a malformed base', async () => {
    await expect(assertDialableRuntimeUrl('http://127.0.0.1:11434')).resolves.toBeUndefined();
    await expect(assertDialableRuntimeUrl('http://192.168.1.50:11434')).resolves.toBeUndefined();
    for (const value of [
      'http://169.254.169.254',
      'http://[::ffff:169.254.169.254]:11434',
      'http://127.0.0.1:11434?',
    ]) {
      await expect(assertDialableRuntimeUrl(value)).rejects.toThrow();
    }
  });
});
