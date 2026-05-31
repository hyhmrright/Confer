import { beforeEach, describe, expect, test } from 'bun:test';
import {
  deleteMemory,
  ensureMemoryCollection,
  searchMemories,
  upsertMemory,
} from './memory-store.js';

// A deterministic unit vector helper: index `seed` is 1, rest 0.
function vec(seed: number): number[] {
  const v = new Array(1536).fill(0);
  v[seed % 1536] = 1;
  return v;
}

const userA = '01HMEMUSERAAAAAAAAAAAAAAAA';
const userB = '01HMEMUSERBBBBBBBBBBBBBBBB';

describe('memory-store', () => {
  beforeEach(async () => {
    await ensureMemoryCollection();
    // Clean any leftover points for these test users.
    await deleteMemory(userA, undefined);
    await deleteMemory(userB, undefined);
  });

  test('upserts a memory and finds it by similar vector', async () => {
    const id = '01HMEM00000000000000000001';
    await upsertMemory({
      memoryId: id,
      userId: userA,
      text: '用户偏好 TypeScript',
      vector: vec(1),
    });
    const hits = await searchMemories(vec(1), userA, 5, 0.3);
    expect(hits.length).toBe(1);
    expect(hits[0]?.memoryId).toBe(id);
    expect(hits[0]?.text).toBe('用户偏好 TypeScript');
    expect(hits[0]?.score).toBeGreaterThan(0.9);
  });

  test('scopes search to user_id', async () => {
    await upsertMemory({
      memoryId: '01HMEM00000000000000000002',
      userId: userA,
      text: 'A 的记忆',
      vector: vec(2),
    });
    await upsertMemory({
      memoryId: '01HMEM00000000000000000003',
      userId: userB,
      text: 'B 的记忆',
      vector: vec(2),
    });
    const hitsB = await searchMemories(vec(2), userB, 5, 0.3);
    expect(hitsB.length).toBe(1);
    expect(hitsB[0]?.text).toBe('B 的记忆');
  });

  test('filters out hits below the score threshold', async () => {
    await upsertMemory({
      memoryId: '01HMEM00000000000000000004',
      userId: userA,
      text: '不相关',
      vector: vec(10),
    });
    const hits = await searchMemories(vec(500), userA, 5, 0.3);
    expect(hits.length).toBe(0);
  });

  test('deletes a single memory by id', async () => {
    const id = '01HMEM00000000000000000005';
    await upsertMemory({ memoryId: id, userId: userA, text: '待删', vector: vec(7) });
    await deleteMemory(userA, id);
    const hits = await searchMemories(vec(7), userA, 5, 0.3);
    expect(hits.length).toBe(0);
  });
});
