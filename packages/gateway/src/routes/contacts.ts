import { Hono } from 'hono';
import { contactLookupSchema, AppError, newId } from '@confer/shared';
import { authMiddleware } from '../middleware/auth.js';
import { getDb } from '../db/connection.js';
import { peerContacts, peerAgents } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import type { AppEnv } from '../types.js';

export const contactRoutes = new Hono<AppEnv>();

contactRoutes.use('/*', authMiddleware);

contactRoutes.get('/', async (c) => {
  const user = c.get('user');
  const db = getDb();

  const contacts = await db
    .select()
    .from(peerContacts)
    .innerJoin(peerAgents, eq(peerContacts.peer_id, peerAgents.id))
    .where(eq(peerContacts.user_id, user.sub));

  return c.json({
    contacts: contacts.map((row) => ({
      ...row.peer_contacts,
      peer: row.peer_agents,
    })),
  });
});

contactRoutes.post('/', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const body = await c.req.json();

  const peerId = body.peer_id as string;
  const [peer] = await db
    .select()
    .from(peerAgents)
    .where(eq(peerAgents.id, peerId))
    .limit(1);

  if (!peer) {
    throw new AppError('not_found', 'Peer agent not found', 404);
  }

  const contactId = newId();
  const [contact] = await db
    .insert(peerContacts)
    .values({
      id: contactId,
      user_id: user.sub,
      peer_id: peerId,
      alias: body.alias,
      added_via: body.added_via ?? 'manual',
    })
    .returning();

  return c.json({ contact }, 201);
});

contactRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const contactId = c.req.param('id');

  const [contact] = await db
    .select()
    .from(peerContacts)
    .where(and(eq(peerContacts.id, contactId), eq(peerContacts.user_id, user.sub)))
    .limit(1);

  if (!contact) {
    throw new AppError('not_found', 'Contact not found', 404);
  }

  await db
    .delete(peerContacts)
    .where(eq(peerContacts.id, contactId));

  return c.json({ ok: true });
});

contactRoutes.post('/lookup', async (c) => {
  const body = contactLookupSchema.parse(await c.req.json());

  // TODO: implement DID/domain resolution
  return c.json({ candidates: [], method: body.method });
});
