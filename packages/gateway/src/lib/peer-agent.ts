import { newId } from '@confer/shared';
import { getDb } from '../db/connection.js';
import { peerAgents } from '../db/schema.js';

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
export async function upsertPeerAgent(input: UpsertPeerAgentInput) {
  const db = getDb();
  const agentFacts = (input.agentFacts ?? {}) as Record<string, unknown>;

  const updateSet: Record<string, unknown> = {
    endpoint: input.endpoint,
    agent_facts_json: agentFacts,
    fetched_at: new Date(),
    updated_at: new Date(),
  };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.description !== undefined) updateSet.description = input.description;

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

  return row;
}
