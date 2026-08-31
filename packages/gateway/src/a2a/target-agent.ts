import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, users } from '../db/schema.js';

// Which local agent an inbound A2A message is addressed to. The two bindings
// name the target differently — Confer's own carries a `to` DID, the spec's
// REST binding carries the interface's opaque `tenant` selector — so each
// lookup lives here and both share the visibility rules below.

export type Agent = typeof agents.$inferSelect;

/** A suspended agent is treated as absent everywhere; never reveal the suspension. */
export function isReachable(agent: Agent | undefined): agent is Agent {
  return agent !== undefined && agent.status !== 'suspended';
}

/**
 * The local agent named by either DID that identifies it.
 *
 * Two identifiers reach us for the same agent and both are legitimate. Public
 * discovery (`/.well-known/agents.json`) lists the AGENT did — `<user>:agent` —
 * and that is what a domain lookup records. But the only document anyone can
 * *resolve* is the OWNER's, published at `/agents/<username>/did.json`, and it
 * is the identifier the app shows its user behind a copy button. A peer holding
 * that DID is doing exactly the right thing.
 *
 * Matching only the agent DID meant every contact added from a pasted DID was
 * unreachable: the transport connected, the signature verified, and delivery
 * then failed with "Target agent not found".
 */
export async function findAgentByDid(to: string) {
  const db = getDb();
  const [byAgentDid] = await db.select().from(agents).where(eq(agents.did, to)).limit(1);
  if (byAgentDid) return byAgentDid;

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.did, to)).limit(1);
  if (!owner) return undefined;

  const [byOwner] = await db.select().from(agents).where(eq(agents.user_id, owner.id)).limit(1);
  return byOwner;
}

/**
 * The local agent behind an Agent Card's `tenant` selector.
 *
 * The Card publishes the owner's username as the tenant, because it is already
 * the stable public part of the agent's DID. A standard client holds only the
 * Card, so this is the one way it can address an agent on a multi-user
 * instance — it never sees a DID.
 */
export async function findAgentByTenant(tenant: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(agents)
    .innerJoin(users, eq(agents.user_id, users.id))
    .where(eq(users.username, tenant))
    .limit(1);
  return row?.agents;
}

/**
 * The single agent this instance can be addressed as without a tenant.
 *
 * `tenant` is optional in every spec request, and on a single-user self-host
 * there is genuinely no ambiguity — the same condition under which
 * `/.well-known/agent-card.json` is willing to answer. With two or more public
 * agents there is no such thing as "the" agent here, so this returns nothing
 * and the caller asks the client to name a tenant rather than guessing which
 * account it meant.
 */
export async function findSolePublicAgent() {
  const db = getDb();
  const rows = await db
    .select()
    .from(agents)
    // The same two conditions `/.well-known/agent-card.json` applies, so the
    // agent a client can discover without a tenant is the one it can then
    // address without a tenant.
    .where(and(eq(agents.is_public, true), eq(agents.status, 'active')))
    // Two is enough to know it is ambiguous; no reason to read the rest.
    .limit(2);
  return rows.length === 1 ? rows[0] : undefined;
}
