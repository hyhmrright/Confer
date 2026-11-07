import { randomBytes } from 'node:crypto';
import { AppError, encrypt, newId } from '@confer/shared';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { capabilityGrants, knowledgeBases, peerAgents, peerCredentials } from '../db/schema.js';
import { getEnv } from '../env.js';
import { hashApiToken } from '../lib/api-tokens.js';
import { writeAudit } from '../lib/audit.js';
import { assertIsContact } from '../lib/tenant.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const capabilityRoutes = new Hono<AppEnv>();
capabilityRoutes.use('/*', authMiddleware, requireSession);
const input = z.object({
  name: z.string().trim().min(1).max(64),
  peer_id: z.string().length(26),
  signer_did: z.string().startsWith('did:web:').max(255),
  kb_ids: z.array(z.string().length(26)).min(1).max(50),
  expires_in_hours: z.number().int().min(1).max(720),
});
const listed = {
  id: capabilityGrants.id,
  name: capabilityGrants.name,
  peer_id: capabilityGrants.peer_id,
  signer_did: capabilityGrants.signer_did,
  kb_ids: capabilityGrants.kb_ids,
  expires_at: capabilityGrants.expires_at,
  revoked_at: capabilityGrants.revoked_at,
  created_at: capabilityGrants.created_at,
};
capabilityRoutes.get('/', async (c) =>
  c.json({
    grants: await getDb()
      .select(listed)
      .from(capabilityGrants)
      .where(eq(capabilityGrants.user_id, c.get('user').sub))
      .orderBy(desc(capabilityGrants.id))
      .limit(100),
  }),
);
capabilityRoutes.post('/', async (c) => {
  const body = input.parse(await c.req.json());
  const userId = c.get('user').sub;
  await assertIsContact(userId, body.peer_id);
  const [peer] = await getDb().select().from(peerAgents).where(eq(peerAgents.id, body.peer_id));
  // A caller may select the owner's signer DID when the stored contact is its
  // agent DID. No unrelated DID can be bound to another contact's grant.
  if (!peer || !(peer.did === body.signer_did || peer.did.startsWith(`${body.signer_did}:`))) {
    throw new AppError('invalid_signer', 'Signer must be the contact DID or its owner', 400);
  }
  const shared = await getDb()
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.user_id, userId), eq(knowledgeBases.shared_with_peers, true)));
  if (body.kb_ids.some((id) => !shared.some((kb) => kb.id === id))) {
    throw new AppError('invalid_scope', 'Scope must contain owned, shared knowledge bases', 400);
  }
  const token = `cfc_${randomBytes(32).toString('base64url')}`;
  const [grant] = await getDb()
    .insert(capabilityGrants)
    .values({
      id: newId(),
      user_id: userId,
      name: body.name,
      peer_id: body.peer_id,
      signer_did: body.signer_did,
      kb_ids: [...new Set(body.kb_ids)],
      token_hash: hashApiToken(token),
      expires_at: new Date(Date.now() + body.expires_in_hours * 3_600_000),
    })
    .returning(listed);
  await writeAudit(c, 'capability.created', { grant_id: grant?.id });
  return c.json({ grant, token }, 201);
});
capabilityRoutes.delete('/:id', async (c) => {
  const [grant] = await getDb()
    .update(capabilityGrants)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(capabilityGrants.id, c.req.param('id')),
        eq(capabilityGrants.user_id, c.get('user').sub),
      ),
    )
    .returning({ id: capabilityGrants.id });
  if (!grant) throw new AppError('not_found', 'Grant not found', 404);
  await writeAudit(c, 'capability.revoked', { grant_id: grant.id });
  return c.json({ ok: true });
});

capabilityRoutes.get('/remote/:peerId', async (c) => {
  await assertIsContact(c.get('user').sub, c.req.param('peerId'));
  const [row] = await getDb()
    .select({ id: peerCredentials.id })
    .from(peerCredentials)
    .where(
      and(
        eq(peerCredentials.user_id, c.get('user').sub),
        eq(peerCredentials.peer_id, c.req.param('peerId')),
      ),
    );
  return c.json({ configured: !!row });
});
capabilityRoutes.put('/remote/:peerId', async (c) => {
  const userId = c.get('user').sub;
  const peerId = c.req.param('peerId');
  await assertIsContact(userId, peerId);
  const body = z
    .object({ token: z.string().regex(/^cfc_[A-Za-z0-9_-]{43}$/) })
    .parse(await c.req.json());
  const sealed = await encrypt(body.token, getEnv().ENCRYPTION_KEY);
  if (!sealed.ok) throw new AppError('encryption_failed', 'Cannot store capability', 500);
  await getDb()
    .insert(peerCredentials)
    .values({ id: newId(), user_id: userId, peer_id: peerId, token_json: sealed.value })
    .onConflictDoUpdate({
      target: [peerCredentials.user_id, peerCredentials.peer_id],
      set: { token_json: sealed.value },
    });
  return c.json({ ok: true });
});
capabilityRoutes.delete('/remote/:peerId', async (c) => {
  await getDb()
    .delete(peerCredentials)
    .where(
      and(
        eq(peerCredentials.user_id, c.get('user').sub),
        eq(peerCredentials.peer_id, c.req.param('peerId')),
      ),
    );
  return c.json({ ok: true });
});
