import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { peerAgents } from '../db/schema.js';

/** A persisted peer agent, including the id that contact creation requires. */
export type PeerAgentRow = typeof peerAgents.$inferSelect;

export interface UpsertPeerAgentInput {
  did: string;
  endpoint: string;
  name?: string;
  description?: string;
  agentFacts?: unknown;
}

// Persist (insert or refresh) a peer agent keyed by its unique DID, returning
// the local row — including the 26-char id that contact creation requires.
//
// Consolidates the peer upsert that contact discovery (contacts.ts) and inbound
// A2A (a2a.ts) each open-coded. Only the metadata fields actually supplied are
// written on conflict, so a metadata-light caller (inbound A2A, which knows only
// did + endpoint) never clobbers richer metadata a discovery lookup already
// stored for the same peer.
export async function upsertPeerAgent(input: UpsertPeerAgentInput): Promise<PeerAgentRow> {
  const db = getDb();
  const agentFacts = (input.agentFacts ?? {}) as Record<string, unknown>;

  const updateSet: Record<string, unknown> = {
    agent_facts_json: agentFacts,
    fetched_at: new Date(),
    updated_at: new Date(),
  };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.description !== undefined) updateSet.description = input.description;
  // An empty endpoint means "could not work out where this peer lives", never
  // "this peer has no endpoint" — inbound A2A passes whatever DID resolution
  // returned, and that is '' whenever it failed. Writing it would erase the
  // endpoint contact discovery had already stored, so the peer would be
  // reachable exactly until it first spoke to us, and every reply after that
  // would be dropped with "No endpoint known for peer".
  if (input.endpoint) updateSet.endpoint = input.endpoint;

  const [row] = await db
    .insert(peerAgents)
    .values({
      id: newId(),
      did: input.did,
      name: input.name,
      description: input.description,
      endpoint: input.endpoint,
      public_key_json: {},
      agent_facts_json: agentFacts,
    })
    .onConflictDoUpdate({
      target: peerAgents.did,
      set: updateSet,
    })
    .returning();

  // `insert … onConflictDoUpdate … returning()` always yields exactly one row;
  // the destructure is what makes it look optional. Fail loudly rather than
  // handing callers an undefined they would use as a peer id.
  if (!row) {
    throw new Error(`Failed to upsert peer agent ${input.did}`);
  }
  return row;
}
