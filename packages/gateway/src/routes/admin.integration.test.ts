import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, appConfig, conversations, messages, sessions, users } from '../db/schema.js';
import { type SeededUser, get, patch, post, resetDb, seedUser } from '../test/helpers.js';

let admin: SeededUser;
let member: SeededUser;

async function makeAdmin(userId: string): Promise<void> {
  await getDb().update(users).set({ role: 'admin' }).where(eq(users.id, userId));
}

beforeEach(async () => {
  await resetDb();
  admin = await seedUser('admin1');
  await makeAdmin(admin.id);
  member = await seedUser('member1');
});

describe('admin guard', () => {
  test('rejects unauthenticated requests', async () => {
    expect((await get('/api/v1/admin/users')).status).toBe(401);
  });

  test('rejects non-admin members with 403', async () => {
    const res = await get('/api/v1/admin/users', { token: member.token });
    expect(res.status).toBe(403);
  });

  test('allows admins', async () => {
    const res = await get('/api/v1/admin/users', { token: admin.token });
    expect(res.status).toBe(200);
  });
});

describe('admin user list', () => {
  test('returns paginated users without secrets', async () => {
    const res = await get('/api/v1/admin/users', { token: admin.token });
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.users.length).toBe(2);
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('llm_keys');
  });

  test('filters by username query', async () => {
    const res = await get('/api/v1/admin/users?q=member', { token: admin.token });
    const body = await res.json();
    expect(body.users.every((u: { username: string }) => u.username.includes('member'))).toBe(true);
  });
});

describe('admin user mutation', () => {
  test('promotes a member to admin', async () => {
    const res = await patch(`/api/v1/admin/users/${member.id}`, {
      token: admin.token,
      body: { role: 'admin' },
    });
    expect(res.status).toBe(200);
    const [row] = await getDb()
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, member.id));
    expect(row?.role).toBe('admin');
  });

  test('disables a user and revokes their sessions', async () => {
    await getDb()
      .insert(sessions)
      .values({
        id: newId(),
        user_id: member.id,
        device_id: 'd1',
        expires_at: new Date(Date.now() + 86_400_000),
      });

    const res = await patch(`/api/v1/admin/users/${member.id}`, {
      token: admin.token,
      body: { status: 'disabled' },
    });
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, member.id));
    expect(row?.status).toBe('disabled');

    const remaining = await getDb().select().from(sessions).where(eq(sessions.user_id, member.id));
    expect(remaining.length).toBe(0);
  });

  test('blocks an admin from demoting themselves (self-lockout guard)', async () => {
    const res = await patch(`/api/v1/admin/users/${admin.id}`, {
      token: admin.token,
      body: { role: 'member' },
    });
    expect(res.status).toBe(400);
    const [row] = await getDb()
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, admin.id));
    expect(row?.role).toBe('admin');
  });

  test('blocks an admin from disabling themselves', async () => {
    const res = await patch(`/api/v1/admin/users/${admin.id}`, {
      token: admin.token,
      body: { status: 'disabled' },
    });
    expect(res.status).toBe(400);
  });

  test('rejects an empty mutation body', async () => {
    const res = await patch(`/api/v1/admin/users/${member.id}`, {
      token: admin.token,
      body: {},
    });
    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown target', async () => {
    const res = await patch(`/api/v1/admin/users/${newId()}`, {
      token: admin.token,
      body: { role: 'admin' },
    });
    expect(res.status).toBe(404);
  });
});

describe('disabled user enforcement', () => {
  test('auth middleware rejects a disabled user with 403', async () => {
    await getDb().update(users).set({ status: 'disabled' }).where(eq(users.id, member.id));
    const res = await get('/api/v1/users/me', { token: member.token });
    expect(res.status).toBe(403);
  });
});

describe('admin stats', () => {
  test('returns system counts', async () => {
    const res = await get('/api/v1/admin/stats', { token: admin.token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toBe(2);
    expect(typeof body.conversations).toBe('number');
    expect(typeof body.contacts).toBe('number');
    expect(typeof body.messages).toBe('number');
  });
});

// --- 3b: content moderation -------------------------------------------------

async function seedAgent(userId: string, isPublic: boolean): Promise<string> {
  const id = newId();
  await getDb()
    .insert(agents)
    .values({
      id,
      user_id: userId,
      did: `did:web:localhost:agents:${id}`,
      name: 'Test agent',
      is_public: isPublic,
    });
  return id;
}

async function seedConversation(userId: string): Promise<string> {
  const id = newId();
  await getDb().insert(conversations).values({
    id,
    type: 'direct_user_agent',
    name: 'Test conversation',
    created_by: userId,
  });
  return id;
}

async function seedMessage(convId: string, senderId: string): Promise<string> {
  const id = newId();
  await getDb().insert(messages).values({
    id,
    conversation_id: convId,
    sender_type: 'user',
    sender_id: senderId,
    content_type: 'text',
    content: 'hello',
  });
  return id;
}

describe('admin agent moderation', () => {
  test('lists agents including their status', async () => {
    await seedAgent(member.id, true);
    const res = await get('/api/v1/admin/agents', { token: admin.token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.agents[0].status).toBe('active');
  });

  test('non-admin cannot list agents', async () => {
    const res = await get('/api/v1/admin/agents', { token: member.token });
    expect(res.status).toBe(403);
  });

  test('suspends an agent and hides it from public discovery', async () => {
    const agentId = await seedAgent(member.id, true);

    const res = await patch(`/api/v1/admin/agents/${agentId}`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId));
    expect(row?.status).toBe('suspended');

    // Suspended agent is filtered from the public well-known discovery list.
    const wellKnown = await get('/.well-known/agents.json');
    const list = (await wellKnown.json()).agents as { did: string }[];
    expect(list.some((a) => a.did === `did:web:localhost:agents:${agentId}`)).toBe(false);
  });

  test('restores a suspended agent back into discovery', async () => {
    const agentId = await seedAgent(member.id, true);
    await patch(`/api/v1/admin/agents/${agentId}`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    await patch(`/api/v1/admin/agents/${agentId}`, {
      token: admin.token,
      body: { status: 'active' },
    });

    const wellKnown = await get('/.well-known/agents.json');
    const list = (await wellKnown.json()).agents as { did: string }[];
    expect(list.some((a) => a.did === `did:web:localhost:agents:${agentId}`)).toBe(true);
  });

  test('returns 404 for an unknown agent', async () => {
    const res = await patch(`/api/v1/admin/agents/${newId()}`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    expect(res.status).toBe(404);
  });
});

describe('admin conversation moderation', () => {
  test('hides a conversation from regular reads but keeps it for admins', async () => {
    const convId = await seedConversation(member.id);

    const res = await patch(`/api/v1/admin/conversations/${convId}`, {
      token: admin.token,
      body: { moderation_status: 'hidden' },
    });
    expect(res.status).toBe(200);

    // Regular read path: hidden conversation is 404 for the member.
    const memberView = await get(`/api/v1/conversations/${convId}`, { token: member.token });
    expect(memberView.status).toBe(404);

    // Admin list still includes it.
    const adminList = await get('/api/v1/admin/conversations', { token: admin.token });
    const convs = (await adminList.json()).conversations as { id: string }[];
    expect(convs.some((cv) => cv.id === convId)).toBe(true);
  });

  test('restores a hidden conversation', async () => {
    const convId = await seedConversation(member.id);
    await patch(`/api/v1/admin/conversations/${convId}`, {
      token: admin.token,
      body: { moderation_status: 'hidden' },
    });
    await patch(`/api/v1/admin/conversations/${convId}`, {
      token: admin.token,
      body: { moderation_status: 'visible' },
    });
    const memberView = await get(`/api/v1/conversations/${convId}`, { token: member.token });
    expect(memberView.status).toBe(200);
  });
});

describe('admin message moderation', () => {
  test('hides a message from the conversation read path', async () => {
    const convId = await seedConversation(member.id);
    const msgId = await seedMessage(convId, member.id);

    const res = await patch(`/api/v1/admin/messages/${msgId}`, {
      token: admin.token,
      body: { moderation_status: 'hidden' },
    });
    expect(res.status).toBe(200);

    const list = await get(`/api/v1/conversations/${convId}/messages`, { token: member.token });
    const msgs = (await list.json()).messages as { id: string }[];
    expect(msgs.some((m) => m.id === msgId)).toBe(false);
  });

  test('returns 404 for an unknown message', async () => {
    const res = await patch(`/api/v1/admin/messages/${newId()}`, {
      token: admin.token,
      body: { moderation_status: 'hidden' },
    });
    expect(res.status).toBe(404);
  });
});

// --- 3c: global config ------------------------------------------------------

describe('admin global config', () => {
  test('returns defaults when no config rows exist', async () => {
    const res = await get('/api/v1/admin/config', { token: admin.token });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.registration_open).toBe(true);
    expect(body.config.instance_name).toBe('Confer');
  });

  test('non-admin cannot read config', async () => {
    const res = await get('/api/v1/admin/config', { token: member.token });
    expect(res.status).toBe(403);
  });

  test('updates config and persists it', async () => {
    const res = await patch('/api/v1/admin/config', {
      token: admin.token,
      body: { registration_open: false, instance_name: 'My Instance' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.registration_open).toBe(false);
    expect(body.config.instance_name).toBe('My Instance');

    const [row] = await getDb()
      .select({ value: appConfig.value })
      .from(appConfig)
      .where(eq(appConfig.key, 'registration_open'));
    expect(row?.value).toBe('false');
  });

  test('rejects an empty config body', async () => {
    const res = await patch('/api/v1/admin/config', { token: admin.token, body: {} });
    expect(res.status).toBe(400);
  });
});

describe('registration switch enforcement', () => {
  test('rejects registration when registration_open is false', async () => {
    await getDb().insert(appConfig).values({ key: 'registration_open', value: 'false' });
    const res = await post('/api/v1/auth/register', {
      body: { username: `new${Date.now()}`, password: 'password123', display_name: 'New' },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('registration_closed');
  });

  test('allows registration when registration_open is true (default)', async () => {
    const res = await post('/api/v1/auth/register', {
      body: { username: `ok${Date.now()}`, password: 'password123', display_name: 'Ok' },
    });
    expect(res.status).toBe(201);
  });
});
