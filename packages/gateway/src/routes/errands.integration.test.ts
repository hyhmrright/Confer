import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { errandCards } from '../db/schema.js';
import { type SeededUser, get, post, resetDb, seedUser } from '../test/helpers.js';

const ERRANDS = '/api/v1/errands';

let user: SeededUser;

beforeEach(async () => {
  await resetDb();
  user = await seedUser();
});

const future = () => new Date(Date.now() + 60_000).toISOString();

async function createErrand(token: string, title = 'Rebook flight'): Promise<string> {
  const res = await post(ERRANDS, { token, body: { title } });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

async function pushCard(
  token: string,
  errandId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await post(`${ERRANDS}/${errandId}/cards`, { token, body });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

// Seed an already-expired card directly (the push schema forbids a past expiry).
async function seedExpiredCard(errandId: string): Promise<string> {
  const id = newId();
  await getDb()
    .insert(errandCards)
    .values({
      id,
      errand_id: errandId,
      kind: 'approve',
      summary: 'stale',
      expires_at: new Date(Date.now() - 60_000),
    });
  return id;
}

describe('errands', () => {
  test('requires authentication', async () => {
    expect((await get(ERRANDS)).status).toBe(401);
  });

  test('owner self-creates an errand and it lists', async () => {
    const id = await createErrand(user.token);
    const list = await (await get(ERRANDS, { token: user.token })).json();
    expect(list.errands).toHaveLength(1);
    expect(list.errands[0].id).toBe(id);
    expect(list.errands[0].owner_user_id).toBe(user.id);
    expect(list.errands[0].status).toBe('in_progress');
  });

  test('WoZ operator creates on the owner account (same endpoint, owner = caller)', async () => {
    // The single operator account is the owner here; the create path is identical.
    const id = await createErrand(user.token, 'Dispute a charge');
    const detail = await (await get(`${ERRANDS}/${id}`, { token: user.token })).json();
    expect(detail.errand.title).toBe('Dispute a charge');
    expect(detail.cards).toHaveLength(0);
  });

  test('push a change_price card; it surfaces as pending', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'change_price',
      summary: 'Fare went up',
      base_price_cents: 20000,
      price_delta_cents: 3500,
      strictly_necessary: true,
      expires_at: future(),
    });

    const pending = await (await get(`${ERRANDS}/cards/pending`, { token: user.token })).json();
    expect(pending.cards).toHaveLength(1);
    expect(pending.cards[0].id).toBe(cardId);
    expect(pending.cards[0].price_delta_cents).toBe(3500);
    expect(pending.cards[0].errand_title).toBe('Rebook flight');
  });

  test('approve a card', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'approve',
      summary: 'Confirm?',
      expires_at: future(),
    });

    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'approve' },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).decision).toBe('approve');

    const [row] = await getDb().select().from(errandCards).where(eq(errandCards.id, cardId));
    expect(row?.decision).toBe('approve');
    expect(row?.decided_by).toBe(user.id);

    // Decided cards leave the pending inbox.
    const pending = await (await get(`${ERRANDS}/cards/pending`, { token: user.token })).json();
    expect(pending.cards).toHaveLength(0);
  });

  test('change_price stores the owner counter price', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'change_price',
      summary: 'Fare went up',
      base_price_cents: 20000,
      price_delta_cents: 3500,
      expires_at: future(),
    });

    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'change_price', new_price_cents: 21000 },
    });
    expect(res.status).toBe(200);

    const [row] = await getDb().select().from(errandCards).where(eq(errandCards.id, cardId));
    expect(row?.decision).toBe('change_price');
    expect(row?.new_price_cents).toBe(21000);
  });

  test('reject a card', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'approve',
      summary: 'Confirm?',
      expires_at: future(),
    });

    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'reject' },
    });
    expect(res.status).toBe(200);
    const [row] = await getDb().select().from(errandCards).where(eq(errandCards.id, cardId));
    expect(row?.decision).toBe('reject');
  });

  test('change_price decision without new_price_cents is rejected (400)', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'approve',
      summary: 'Confirm?',
      expires_at: future(),
    });
    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'change_price' },
    });
    expect(res.status).toBe(400);
  });

  test('deciding an expired card returns 409', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await seedExpiredCard(errandId);
    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'approve' },
    });
    expect(res.status).toBe(409);

    // And an expired card never appears in the pending inbox.
    const pending = await (await get(`${ERRANDS}/cards/pending`, { token: user.token })).json();
    expect(pending.cards).toHaveLength(0);
  });

  test('deciding an already-decided card returns 409', async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'approve',
      summary: 'Confirm?',
      expires_at: future(),
    });
    await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'approve' },
    });
    const second = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: user.token,
      body: { decision: 'reject' },
    });
    expect(second.status).toBe(409);
  });

  test("a non-owner cannot decide another owner's card (403)", async () => {
    const errandId = await createErrand(user.token);
    const cardId = await pushCard(user.token, errandId, {
      kind: 'approve',
      summary: 'Confirm?',
      expires_at: future(),
    });
    const other = await seedUser();
    const res = await post(`${ERRANDS}/cards/${cardId}/decide`, {
      token: other.token,
      body: { decision: 'approve' },
    });
    expect(res.status).toBe(403);

    // The card stays pending — the non-owner's attempt changed nothing.
    const [row] = await getDb().select().from(errandCards).where(eq(errandCards.id, cardId));
    expect(row?.decision).toBe('pending');
  });

  test('a non-owner cannot push a card onto an errand (404)', async () => {
    const errandId = await createErrand(user.token);
    const other = await seedUser();
    const res = await post(`${ERRANDS}/${errandId}/cards`, {
      token: other.token,
      body: { kind: 'approve', summary: 's', expires_at: future() },
    });
    expect(res.status).toBe(404);
  });

  test('scopes errands and pending cards to their owner', async () => {
    await createErrand(user.token);
    const other = await seedUser();
    expect((await (await get(ERRANDS, { token: other.token })).json()).errands).toHaveLength(0);
    expect(
      (await (await get(`${ERRANDS}/cards/pending`, { token: other.token })).json()).cards,
    ).toHaveLength(0);
  });

  test('returns 404 pushing onto an unknown errand', async () => {
    const res = await post(`${ERRANDS}/${newId()}/cards`, {
      token: user.token,
      body: { kind: 'approve', summary: 's', expires_at: future() },
    });
    expect(res.status).toBe(404);
  });
});
