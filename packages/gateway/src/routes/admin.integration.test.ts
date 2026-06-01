import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { sessions, users } from '../db/schema.js';
import { type SeededUser, get, patch, resetDb, seedUser } from '../test/helpers.js';

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
