import { afterEach, describe, expect, test } from 'bun:test';
import { qdrantUrl } from './qdrant-client.js';

describe('qdrantUrl', () => {
  const original = process.env.QDRANT_URL;
  afterEach(() => {
    // biome-ignore lint/performance/noDelete: must unset env var; assigning undefined coerces to the string "undefined"
    if (original === undefined) delete process.env.QDRANT_URL;
    else process.env.QDRANT_URL = original;
  });

  test('uses QDRANT_URL when set', () => {
    process.env.QDRANT_URL = 'http://qdrant:6333';
    expect(qdrantUrl('/collections/x')).toBe('http://qdrant:6333/collections/x');
  });

  test('falls back to localhost:6333 when QDRANT_URL is unset', () => {
    // biome-ignore lint/performance/noDelete: must unset env var; assigning undefined coerces to the string "undefined"
    delete process.env.QDRANT_URL;
    expect(qdrantUrl('/collections/x')).toBe('http://localhost:6333/collections/x');
  });
});
