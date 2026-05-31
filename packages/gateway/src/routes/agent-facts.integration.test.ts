import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { get, resetDb, seedUser } from '../test/helpers.js';

beforeEach(resetDb);

describe('GET /a2a/v1/agent-facts/:agentDid', () => {
  test('returns 404 for an unknown agent', async () => {
    const res = await get('/a2a/v1/agent-facts/did:web:nope');
    expect(res.status).toBe(404);
  });

  test('returns a NANDA-shaped fact sheet for a known agent', async () => {
    const user = await seedUser();
    const did = 'did:web:localhost:agents:facts';
    await getDb()
      .insert(agents)
      .values({
        id: newId(),
        user_id: user.id,
        did,
        name: 'Facts Agent',
        description: 'Test agent',
        capabilities_json: ['chat'],
      });

    const res = await get(`/a2a/v1/agent-facts/${did}`);
    expect(res.status).toBe(200);
    const facts = await res.json();
    expect(facts['@context']).toBe('https://nanda.dev/schemas/agent/v1');
    expect(facts.did).toBe(did);
    expect(facts.capabilities).toEqual(['chat']);
    expect(facts.endpoints.a2a).toContain('/a2a/v1');
  });
});
