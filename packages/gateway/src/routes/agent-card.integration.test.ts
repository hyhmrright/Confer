import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { agents } from '../db/schema.js';
import { get, resetDb, type SeededUser, seedUser } from '../test/helpers.js';

beforeEach(resetDb);

async function seedAgent(
  user: SeededUser,
  opts: { isPublic?: boolean; status?: string; capabilities?: string[] } = {},
): Promise<void> {
  await getDb()
    .insert(agents)
    .values({
      id: newId(),
      user_id: user.id,
      did: `did:web:localhost:agents:${user.username}`,
      name: `${user.username} 的助手`,
      description: '回答产品问题',
      is_public: opts.isPublic ?? true,
      status: opts.status ?? 'active',
      capabilities_json: opts.capabilities ?? [],
    });
}

describe('GET /agents/:username/agent-card.json', () => {
  test('serves a conformant card for a public agent', async () => {
    const user = await seedUser('alice');
    await seedAgent(user, { capabilities: ['产品咨询'] });

    const res = await get(`/agents/${user.username}/agent-card.json`);
    expect(res.status).toBe(200);

    const card = await res.json();
    expect(card.name).toBe('alice 的助手');
    expect(card.supportedInterfaces[0]).toMatchObject({
      protocolBinding: 'HTTP+JSON',
      protocolVersion: '1.0',
      // One endpoint serves every agent here, so the tenant is what makes this
      // interface addressable rather than identical for all of them.
      tenant: 'alice',
    });
    expect(card.capabilities.extensions[0].required).toBe(true);
    expect(card.skills[0].name).toBe('产品咨询');
  });

  test('404s for an agent the owner has not published', async () => {
    const user = await seedUser('alice');
    await seedAgent(user, { isPublic: false });

    // A Card is a discovery document. If this served private agents it would
    // become a way to enumerate accounts their owners deliberately did not
    // publish — the directory at /.well-known/agents.json hides them, and the
    // two must not disagree.
    expect((await get(`/agents/${user.username}/agent-card.json`)).status).toBe(404);
  });

  test('404s for a suspended agent', async () => {
    const user = await seedUser('alice');
    await seedAgent(user, { status: 'suspended' });

    expect((await get(`/agents/${user.username}/agent-card.json`)).status).toBe(404);
  });

  test('404s for an unknown username', async () => {
    expect((await get('/agents/nobody/agent-card.json')).status).toBe(404);
  });
});

describe('GET /.well-known/agent-card.json', () => {
  test('serves the single public agent when the instance hosts exactly one', async () => {
    // The single-user self-host case, which is where the spec's one-agent-per-
    // domain assumption actually holds.
    const user = await seedUser('solo');
    await seedAgent(user);

    const res = await get('/.well-known/agent-card.json');
    expect(res.status).toBe(200);
    expect((await res.json()).supportedInterfaces[0].tenant).toBe('solo');
  });

  test('404s when several public agents make the question ambiguous', async () => {
    const alice = await seedUser('alice');
    const bob = await seedUser('bob');
    await seedAgent(alice);
    await seedAgent(bob);

    // Answering would mean picking an arbitrary account and calling it "the"
    // agent of this domain. The 404 body points at the directory instead.
    const res = await get('/.well-known/agent-card.json');
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toContain('agents.json');
  });

  test('404s when no agent is public, rather than exposing a private one', async () => {
    const user = await seedUser('alice');
    await seedAgent(user, { isPublic: false });

    expect((await get('/.well-known/agent-card.json')).status).toBe(404);
  });
});
