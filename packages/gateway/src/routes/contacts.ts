import { resolveDID } from '@confer/identity';
import { AppError, contactLookupSchema, newId } from '@confer/shared';
import { and, eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { agents, peerAgents, peerContacts } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const addContactSchema = z.object({
  peer_id: z.string().length(26),
  alias: z.string().max(128).optional(),
  added_via: z.string().max(32).optional(),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

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
  const body = addContactSchema.parse(await c.req.json());

  const [peer] = await db.select().from(peerAgents).where(eq(peerAgents.id, body.peer_id)).limit(1);

  if (!peer) {
    throw new AppError('not_found', 'Peer agent not found', 404);
  }

  const contactId = newId();
  const [contact] = await db
    .insert(peerContacts)
    .values({
      id: contactId,
      user_id: user.sub,
      peer_id: body.peer_id,
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

  await db.delete(peerContacts).where(eq(peerContacts.id, contactId));

  return c.json({ ok: true });
});

contactRoutes.post('/lookup', async (c) => {
  const body = contactLookupSchema.parse(await c.req.json());

  if (body.method === 'domain') {
    try {
      const parsed = new URL(`https://${body.value}`);
      const hostname = parsed.hostname;
      if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
        return c.json({
          candidates: [],
          method: body.method,
          error: 'Private addresses not allowed',
        });
      }
      const res = await withTimeout(fetch(`https://${hostname}/.well-known/agents.json`), 5000);
      const data = (await res.json()) as { agents?: unknown[] };
      return c.json({ candidates: data.agents ?? [], method: body.method });
    } catch (e) {
      return c.json({ candidates: [], method: body.method, error: (e as Error).message });
    }
  }

  if (body.method === 'did') {
    try {
      const result = await withTimeout(resolveDID(body.value), 5000);
      if (!result.ok) {
        return c.json({ candidates: [], method: body.method, error: result.error });
      }
      const doc = result.value;
      return c.json({ candidates: [{ did: doc.id, service: doc.service }], method: body.method });
    } catch (e) {
      return c.json({ candidates: [], method: body.method, error: (e as Error).message });
    }
  }

  if (body.method === 'username') {
    const db = getDb();
    const rows = await db
      .select({
        did: agents.did,
        name: agents.name,
        description: agents.description,
        is_public: agents.is_public,
      })
      .from(agents)
      .where(
        and(
          like(agents.did, `%${body.value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
          eq(agents.is_public, true),
        ),
      )
      .limit(20);
    return c.json({ candidates: rows, method: body.method });
  }

  return c.json({ candidates: [], method: body.method });
});
