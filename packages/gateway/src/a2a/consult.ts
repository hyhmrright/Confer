import { type Result, err, ok } from '@confer/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { agents, peerAgents } from '../db/schema.js';
import { sendA2AMessage } from './outbound.js';
import { loadActiveAgentKey } from './signing.js';

export interface DeliverConsultInput {
  userId: string;
  peerId: string;
  conversationId: string;
  content: string;
}

export interface DeliverConsultOutput {
  fromDid: string;
  toDid: string;
}

/**
 * Sign and deliver a user-initiated consult question to a peer agent. The
 * signing key never leaves the gateway; thread_id carries the conversation id
 * so the peer's async answer can be correlated back to this thread.
 */
export async function deliverConsult(
  input: DeliverConsultInput,
): Promise<Result<DeliverConsultOutput, string>> {
  const db = getDb();

  const [agent] = await db.select().from(agents).where(eq(agents.user_id, input.userId)).limit(1);
  if (!agent) return err('no_agent');

  const [peer] = await db.select().from(peerAgents).where(eq(peerAgents.id, input.peerId)).limit(1);
  if (!peer) return err('peer_not_found');
  if (!peer.endpoint) return err('peer_no_endpoint');

  const key = await loadActiveAgentKey(agent.id);
  if (!key.ok) return err(key.error);

  const result = await sendA2AMessage(
    peer.endpoint,
    {
      from: agent.did,
      to: peer.did,
      thread_id: input.conversationId,
      message: { type: 'question', content: input.content },
    },
    key.value.keyId,
    key.value.privateKeyJwk,
  );

  if (!result.ok) return err(result.error);
  return ok({ fromDid: agent.did, toDid: peer.did });
}
