import { AppError } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { agents, users } from '../db/schema.js';
import { buildAgentCard } from '../lib/agent-card.js';
import { selfA2AEndpoint, selfOrigin } from '../lib/public-identity.js';

// A2A Agent Cards (Linux Foundation Agent2Agent v1.0). Public and unsigned,
// like the DID documents beside them — a Card is discovery metadata, and every
// field in it is already published through `/.well-known/agents.json`.

export const agentCardRoutes = new Hono();

/** Load the agent a Card would describe, or 404. Suspended and private agents are not discoverable. */
async function loadPublicAgent(username: string) {
  const db = getDb();

  const [row] = await db
    .select({
      did: agents.did,
      name: agents.name,
      description: agents.description,
      capabilities_json: agents.capabilities_json,
    })
    .from(agents)
    .innerJoin(users, eq(agents.user_id, users.id))
    .where(
      and(
        eq(users.username, username),
        // Same two conditions the public directory applies. A Card is a
        // discovery document, so anything undiscoverable there must be
        // undiscoverable here — otherwise this route quietly becomes a way to
        // enumerate agents their owners never published.
        eq(agents.is_public, true),
        eq(agents.status, 'active'),
      ),
    )
    .limit(1);

  return row;
}

// Per-agent Card. The spec's own well-known path assumes one agent per domain;
// this instance hosts many, which is what the interface's `tenant` selector is
// for, so each agent gets its own document here.
agentCardRoutes.get('/:username/agent-card.json', async (c) => {
  const username = c.req.param('username');
  const agent = await loadPublicAgent(username);
  if (!agent) {
    throw new AppError('not_found', 'Agent not found', 404);
  }

  return c.json(
    buildAgentCard({
      agent,
      username,
      a2aEndpoint: selfA2AEndpoint(),
      instanceUrl: selfOrigin(),
    }),
  );
});

/**
 * The spec's standard discovery path, served only when it can be answered
 * truthfully.
 *
 * `/.well-known/agent-card.json` identifies *the* agent at a domain, and a
 * multi-user instance has no such thing. Rather than invent one — picking an
 * arbitrary account, or synthesizing a Card for an agent nobody can actually
 * address — this answers when exactly one public agent exists, which is the
 * single-user self-host case, and 404s otherwise. A client that gets the 404
 * can still enumerate `/.well-known/agents.json` and fetch a per-agent Card.
 */
export async function wellKnownAgentCard(): Promise<ReturnType<typeof buildAgentCard> | null> {
  const db = getDb();

  const rows = await db
    .select({
      did: agents.did,
      name: agents.name,
      description: agents.description,
      capabilities_json: agents.capabilities_json,
      username: users.username,
    })
    .from(agents)
    .innerJoin(users, eq(agents.user_id, users.id))
    .where(and(eq(agents.is_public, true), eq(agents.status, 'active')))
    // Two is enough to know it is ambiguous; no reason to read the rest.
    .limit(2);

  const only = rows.length === 1 ? rows[0] : undefined;
  if (!only) return null;

  return buildAgentCard({
    agent: only,
    username: only.username,
    a2aEndpoint: selfA2AEndpoint(),
    instanceUrl: selfOrigin(),
  });
}
