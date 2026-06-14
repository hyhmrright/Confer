import { resolveDID } from '@confer/identity';
import { AppError, contactLookupSchema, newId, policyOverridesSchema } from '@confer/shared';
import { and, eq, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { agents, peerAgents, peerContacts } from '../db/schema.js';
import { upsertPeerAgent } from '../lib/peer-agent.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

const addContactSchema = z.object({
  peer_id: z.string().length(26),
  alias: z.string().max(128).optional(),
  added_via: z.string().max(32).optional(),
});

// Partial metadata update for an existing contact. Every field is optional —
// only the keys actually present in the body are written, so e.g. toggling
// `pinned` never clears `alias`. `alias` is nullable so the owner can clear it;
// the other fields keep their column shapes.
const patchContactSchema = z
  .object({
    alias: z.string().max(128).nullable(),
    tags: z.array(z.string()),
    pinned: z.boolean(),
    muted: z.boolean(),
  })
  .partial();

// Shape of an entry in a remote `/.well-known/agents.json`. Only `did` is
// required; the rest is best-effort metadata we surface to the user.
const remoteAgentSchema = z.object({
  did: z.string().min(1),
  name: z.string().max(128).optional(),
  description: z.string().optional(),
});

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Scope a contact row to its owner. Used both to load the contact and to target
// the subsequent write, so a contact id from another user is never reachable.
function contactScope(contactId: string, userSub: string) {
  return and(eq(peerContacts.id, contactId), eq(peerContacts.user_id, userSub));
}

// Load an owner-scoped contact or throw 404 (not 403) so another user's contact
// ids stay indistinguishable from non-existent ones.
async function loadContact(contactId: string, userSub: string) {
  const [contact] = await getDb()
    .select()
    .from(peerContacts)
    .where(contactScope(contactId, userSub))
    .limit(1);

  if (!contact) {
    throw new AppError('not_found', 'Contact not found', 404);
  }

  return contact;
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

  // Adding the same peer twice is idempotent — return the existing contact
  // rather than tripping the unique(user_id, peer_id) constraint with a 500.
  const [existing] = await db
    .select()
    .from(peerContacts)
    .where(and(eq(peerContacts.user_id, user.sub), eq(peerContacts.peer_id, body.peer_id)))
    .limit(1);

  if (existing) {
    return c.json({ contact: existing }, 200);
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

contactRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const contactId = c.req.param('id');

  // Scope by user_id and return 404 (not 403) on a miss so another user's
  // contact ids stay indistinguishable from non-existent ones, matching the
  // DELETE /:id semantics.
  const [row] = await db
    .select()
    .from(peerContacts)
    .innerJoin(peerAgents, eq(peerContacts.peer_id, peerAgents.id))
    .where(and(eq(peerContacts.id, contactId), eq(peerContacts.user_id, user.sub)))
    .limit(1);

  if (!row) {
    throw new AppError('not_found', 'Contact not found', 404);
  }

  return c.json({ contact: { ...row.peer_contacts, peer: row.peer_agents } });
});

contactRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const contactId = c.req.param('id');
  const body = patchContactSchema.parse(await c.req.json());

  await loadContact(contactId, user.sub);

  // Build the update from only the keys the client sent (`.partial()` leaves
  // absent fields `undefined`), so an unsent field is never overwritten.
  const updates: Partial<typeof peerContacts.$inferInsert> = {};
  // Pass `null` through unchanged so an explicit `alias: null` clears the column
  // (drizzle drops `undefined` keys from the UPDATE but writes `null` as SQL NULL).
  if (body.alias !== undefined) updates.alias = body.alias;
  if (body.tags !== undefined) updates.tags = body.tags;
  if (body.pinned !== undefined) updates.pinned = body.pinned;
  if (body.muted !== undefined) updates.muted = body.muted;

  const [updated] = await db
    .update(peerContacts)
    .set(updates)
    .where(contactScope(contactId, user.sub))
    .returning();

  return c.json({ contact: updated });
});

contactRoutes.post('/:id/policies', async (c) => {
  const user = c.get('user');
  const db = getDb();
  const contactId = c.req.param('id');
  // Validate but never log the body — it carries the owner's standing policy.
  const overrides = policyOverridesSchema.parse(await c.req.json());

  await loadContact(contactId, user.sub);

  // PUT semantics (whole-object replace), matching `PUT /me/policies`.
  const [updated] = await db
    .update(peerContacts)
    .set({ policy_overrides_json: overrides })
    .where(contactScope(contactId, user.sub))
    .returning();

  return c.json({ contact: updated });
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

// Each lookup strategy returns the discovered candidates (and an optional
// error string); the route attaches `method` to the response. Splitting them
// keeps each path independently readable and testable.
interface LookupResult {
  candidates: unknown[];
  error?: string;
}

// Shared timeout for the two network-bound lookups (well-known fetch, DID
// resolution).
const LOOKUP_TIMEOUT_MS = 5000;

// Run a network lookup body, mapping any thrown error to the uniform
// LookupResult error shape so a single transport failure can't bubble a 500.
async function safeLookup(fn: () => Promise<LookupResult>): Promise<LookupResult> {
  try {
    return await fn();
  } catch (e) {
    return { candidates: [], error: (e as Error).message };
  }
}

function lookupByDomain(value: string): Promise<LookupResult> {
  return safeLookup(async () => {
    const hostname = new URL(`https://${value}`).hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname)) {
      return { candidates: [], error: 'Private addresses not allowed' };
    }
    const res = await withTimeout(
      fetch(`https://${hostname}/.well-known/agents.json`),
      LOOKUP_TIMEOUT_MS,
    );
    const data = (await res.json()) as { agents?: unknown[] };
    // Every agent on a did:web:<host> instance shares the instance A2A
    // endpoint, mirroring the service entry we publish in did.json.
    const endpoint = `https://${hostname}/a2a/v1`;
    // A server may only advertise did:web identities bound to its own host.
    // Without this, evil.com could list did:web:trusted.com and hijack the
    // trusted peer's endpoint via the upsert (peerAgents.did is unique).
    const hostDid = `did:web:${hostname}`;
    const candidates = [];
    for (const raw of data.agents ?? []) {
      const parsed = remoteAgentSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (parsed.data.did !== hostDid && !parsed.data.did.startsWith(`${hostDid}:`)) continue;
      candidates.push(
        await upsertPeerAgent({
          did: parsed.data.did,
          name: parsed.data.name,
          description: parsed.data.description,
          endpoint,
          agentFacts: raw,
        }),
      );
    }
    return { candidates };
  });
}

function lookupByDid(value: string): Promise<LookupResult> {
  return safeLookup(async () => {
    const result = await withTimeout(resolveDID(value), LOOKUP_TIMEOUT_MS);
    if (!result.ok) {
      return { candidates: [], error: result.error };
    }
    const doc = result.value;
    // The resolved document must claim the DID we asked for; otherwise the
    // host serving `value` could poison a different DID's peerAgents row.
    if (doc.id !== value) {
      return { candidates: [], error: 'DID document id does not match the requested DID' };
    }
    const endpoint = doc.service?.find((s) => s.serviceEndpoint)?.serviceEndpoint;
    if (!endpoint) {
      return { candidates: [], error: 'DID document has no service endpoint' };
    }
    const row = await upsertPeerAgent({ did: value, endpoint, agentFacts: doc });
    return { candidates: [row] };
  });
}

async function lookupByUsername(value: string): Promise<LookupResult> {
  const rows = await getDb()
    .select({
      did: agents.did,
      name: agents.name,
      description: agents.description,
      is_public: agents.is_public,
    })
    .from(agents)
    .where(
      and(
        like(agents.did, `%${value.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
        eq(agents.is_public, true),
        // Suspended agents are hidden from public discovery (moderation 3b).
        eq(agents.status, 'active'),
      ),
    )
    .limit(20);
  return { candidates: rows };
}

contactRoutes.post('/lookup', async (c) => {
  const body = contactLookupSchema.parse(await c.req.json());

  let result: LookupResult;
  if (body.method === 'domain') {
    result = await lookupByDomain(body.value);
  } else if (body.method === 'did') {
    result = await lookupByDid(body.value);
  } else if (body.method === 'username') {
    result = await lookupByUsername(body.value);
  } else {
    result = { candidates: [] };
  }

  return c.json({ ...result, method: body.method });
});
