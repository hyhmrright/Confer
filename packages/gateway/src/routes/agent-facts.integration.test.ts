import { beforeEach, describe, expect, test } from 'bun:test';
import { agentFactsSchema } from '@confer/identity';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { get, patch, resetDb, seedUser } from '../test/helpers.js';

beforeEach(resetDb);

async function seedAgent(): Promise<{ did: string; token: string }> {
  const user = await seedUser();
  const did = `did:web:localhost:agents:${user.username}:agent`;
  await getDb().insert(agents).values({
    id: newId(),
    user_id: user.id,
    did,
    name: 'Facts Agent',
    description: 'Test agent',
  });
  return { did, token: user.token };
}

describe('GET /a2a/v1/agent-facts/:agentDid', () => {
  test('returns 404 for an unknown agent', async () => {
    const res = await get('/a2a/v1/agent-facts/did:web:nope');
    expect(res.status).toBe(404);
  });

  // Driven through PATCH /agents/me, the only writer of capabilities. Contract 3
  // — the route used to publish the column verbatim, schema or not.
  test('publishes schema-valid AgentFacts with the capabilities the owner saved', async () => {
    const { did, token } = await seedAgent();
    const capability = { type: 'code-generation', scope: ['python'], languages: ['en'] };
    const saved = await patch('/api/v1/agents/me', {
      token,
      body: { is_public: true, capabilities_json: [capability] },
    });
    expect(saved.status).toBe(200);

    const res = await get(`/a2a/v1/agent-facts/${did}`);
    expect(res.status).toBe(200);
    const facts = await res.json();
    expect(agentFactsSchema.safeParse(facts).success).toBe(true);
    expect(facts).toEqual({
      '@context': 'https://nanda.dev/schemas/agent/v1',
      did,
      name: 'Facts Agent',
      description: 'Test agent',
      capabilities: [capability],
      endpoints: { a2a: expect.stringContaining('/a2a/v1') },
    });
  });

  // The route stored any object, and the fact sheet then left out whatever was
  // not a capability — silently, to an owner who believed it saved.
  test('refuses to save an entry that is not a capability', async () => {
    const { did, token } = await seedAgent();
    const capability = { type: 'code-generation', scope: [], languages: [] };
    const res = await patch('/api/v1/agents/me', {
      token,
      body: { capabilities_json: [capability, { note: 'not a capability' }] },
    });
    expect(res.status).toBe(400);

    const [row] = await getDb()
      .select({ capabilities: agents.capabilities_json })
      .from(agents)
      .where(eq(agents.did, did));
    expect(row?.capabilities).toEqual([]);
  });

  // A row saved before the route checked the shape can hold anything, and what
  // gets published from it is only what is a capability.
  test('publishes only the capabilities out of an older row', async () => {
    const { did } = await seedAgent();
    const capability = { type: 'translation', scope: [], languages: ['ja'] };
    await getDb()
      .update(agents)
      .set({ is_public: true, capabilities_json: ['chat', { note: 'not one' }, capability] })
      .where(eq(agents.did, did));

    const facts = await (await get(`/a2a/v1/agent-facts/${did}`)).json();
    expect(facts.capabilities).toEqual([capability]);
  });

  // The Agent Card refuses a private or suspended agent so its existence cannot
  // be probed; the fact sheet answered for both.
  test('returns 404 for an agent that is not public, or is suspended', async () => {
    const { did, token } = await seedAgent();
    expect((await get(`/a2a/v1/agent-facts/${did}`)).status).toBe(404);

    await patch('/api/v1/agents/me', { token, body: { is_public: true } });
    await getDb().update(agents).set({ status: 'suspended' }).where(eq(agents.did, did));
    expect((await get(`/a2a/v1/agent-facts/${did}`)).status).toBe(404);
  });
});
