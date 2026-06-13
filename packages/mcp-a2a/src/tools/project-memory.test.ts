import { describe, expect, test } from 'bun:test';
import type { GatewayClient } from '../gateway-client.js';
import { readProjectMemory, writeProjectMemory } from './project-memory.js';

// Records each call so tests can assert the exact path/body, and returns canned
// responses keyed by `METHOD path`.
function clientStub(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const client = {
    get: async (p: string) => {
      calls.push({ method: 'GET', path: p });
      return routes[`GET ${p}`];
    },
    put: async (p: string, body?: unknown) => {
      calls.push({ method: 'PUT', path: p, body });
      return routes[`PUT ${p}`];
    },
    whoami: () => 'u',
  } as unknown as GatewayClient;
  return { client, calls };
}

const FACTS = '/api/v1/projects/confer/peers/p1/facts';
const DECISIONS = '/api/v1/projects/confer/peers/p1/decisions';

describe('writeProjectMemory', () => {
  test('PUTs facts to the facts path with facts_md body', async () => {
    const { client, calls } = clientStub({
      [`PUT ${FACTS}`]: { facts_md: 'x', version: 1, updated_at: '2026-06-13T00:00:00Z' },
    });
    const out = await writeProjectMemory(client, {
      projectId: 'confer',
      peerId: 'p1',
      section: 'facts',
      content: 'x',
    });
    expect(calls[0]).toEqual({ method: 'PUT', path: FACTS, body: { facts_md: 'x' } });
    expect(out.section).toBe('facts');
    expect(out.version).toBe(1);
  });

  test('PUTs decisions to the decisions path with decisions_md body', async () => {
    const { client, calls } = clientStub({
      [`PUT ${DECISIONS}`]: { decisions_md: 'd', version: 2, updated_at: null },
    });
    const out = await writeProjectMemory(client, {
      projectId: 'confer',
      peerId: 'p1',
      section: 'decisions',
      content: 'd',
    });
    expect(calls[0]).toEqual({ method: 'PUT', path: DECISIONS, body: { decisions_md: 'd' } });
    expect(out.section).toBe('decisions');
    expect(out.version).toBe(2);
  });
});

describe('readProjectMemory', () => {
  test('reads a single section when section is given', async () => {
    const { client, calls } = clientStub({
      [`GET ${FACTS}`]: { facts_md: 'the facts', version: 3, updated_at: 't' },
    });
    const out = await readProjectMemory(client, {
      projectId: 'confer',
      peerId: 'p1',
      section: 'facts',
    });
    expect(calls.map((c) => c.path)).toEqual([FACTS]);
    expect(out.facts).toBe('the facts');
    expect(out.decisions).toBeUndefined();
    expect(out.version).toBe(3);
  });

  test('reads both sections when section is omitted', async () => {
    const { client, calls } = clientStub({
      [`GET ${FACTS}`]: { facts_md: 'f', version: 5, updated_at: 't' },
      [`GET ${DECISIONS}`]: { decisions_md: 'd', version: 5, updated_at: 't' },
    });
    const out = await readProjectMemory(client, { projectId: 'confer', peerId: 'p1' });
    expect(new Set(calls.map((c) => c.path))).toEqual(new Set([FACTS, DECISIONS]));
    expect(out.facts).toBe('f');
    expect(out.decisions).toBe('d');
  });

  test('empty memory returns empty strings and version 0 without throwing', async () => {
    const { client } = clientStub({
      [`GET ${FACTS}`]: { facts_md: '', version: 0, updated_at: null },
      [`GET ${DECISIONS}`]: { decisions_md: '', version: 0, updated_at: null },
    });
    const out = await readProjectMemory(client, { projectId: 'confer', peerId: 'p1' });
    expect(out.facts).toBe('');
    expect(out.decisions).toBe('');
    expect(out.version).toBe(0);
  });
});
