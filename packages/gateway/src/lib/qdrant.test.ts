import { describe, expect, test } from 'bun:test';
import { toUUID } from './qdrant.js';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('toUUID', () => {
  test('maps an id to a canonical 8-4-4-4-12 hex UUID', () => {
    expect(toUUID('chunk-1')).toMatch(UUID_SHAPE);
  });

  test('converts a ULID (rejected by Qdrant) into an accepted UUID', () => {
    // Regression guard: ULID point ids were silently rejected with HTTP 400
    // until they were hashed into UUID form before upsert.
    expect(toUUID('01JABCDEF0123456789XYZABCD')).toMatch(UUID_SHAPE);
  });

  test('is deterministic for the same id', () => {
    expect(toUUID('same-id')).toBe(toUUID('same-id'));
  });

  test('produces distinct UUIDs for distinct ids', () => {
    expect(toUUID('id-a')).not.toBe(toUUID('id-b'));
  });
});
