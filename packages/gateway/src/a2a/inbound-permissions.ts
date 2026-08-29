import type { PermissionLevel } from '@confer/agent-runtime';
import { classifyPermissionLevel } from '@confer/agent-runtime';
import { newId } from '@confer/shared';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { type peerAgents, permissions } from '../db/schema.js';
import { notifyPermissionRequest } from '../lib/permission-notify.js';

// The two gates an inbound A2A message can be held at: connecting to a stranger,
// and answering a question under an `ask_user` policy. Both write a pending
// `permissions` row and push it to the owner's inbox; both are resumed from
// `routes/permissions.ts` when the owner decides.

// Store a pending permission raised by an inbound peer and push it to the
// owner's inbox. Both A2A gates (connect, ask) land here, so the row shape and
// the notification can never drift apart: `requested_by` is always the peer,
// and the pushed event always carries the same `created_at` that was written.
async function requestPeerPermission(request: {
  userId: string;
  peer: typeof peerAgents.$inferSelect;
  action: 'connect' | 'ask';
  level: PermissionLevel;
  // Stored verbatim as JSONB and interpreted per-action by the inbox card, so
  // any object shape is valid here.
  scope: object;
}): Promise<void> {
  const id = newId();
  const [inserted] = await getDb()
    .insert(permissions)
    .values({
      id,
      user_id: request.userId,
      peer_id: request.peer.id,
      action: request.action,
      scope_json: request.scope,
      level: request.level,
      decision: 'pending',
      requested_by: request.peer.id,
    })
    .returning({ created_at: permissions.created_at });

  notifyPermissionRequest(request.userId, {
    id,
    level: request.level,
    action: request.action,
    scope_json: request.scope,
    peer_name: request.peer.name,
    peer_did: request.peer.did,
    created_at: inserted?.created_at ?? new Date(),
  });
}

// Record a pending connection request from an unconnected peer, deduplicated
// so repeated messages from the same peer don't flood the owner's inbox.
export async function upsertConnectionRequest(
  userId: string,
  peer: typeof peerAgents.$inferSelect,
  firstMessage: string,
): Promise<void> {
  const [existing] = await getDb()
    .select()
    .from(permissions)
    .where(
      and(
        eq(permissions.user_id, userId),
        eq(permissions.peer_id, peer.id),
        eq(permissions.action, 'connect'),
        eq(permissions.decision, 'pending'),
      ),
    )
    .limit(1);

  // Only a genuinely new request gets past here, so the owner is never
  // double-notified for a peer that keeps retrying.
  if (existing) return;

  await requestPeerPermission({
    userId,
    peer,
    action: 'connect',
    level: 'L2',
    scope: {
      peer_did: peer.did,
      peer_name: peer.name,
      first_message: firstMessage.slice(0, 500),
    },
  });
}

// Scope payload stored on a held `ask` permission. Carries exactly what
// `resumeHeldA2AQuestion` needs to rebuild the agent-loop call after approval;
// `targetAgent`/`senderPeer` are re-read from the DB at resume time (by
// user_id/peer_id) so an approval never replays a stale snapshot.
export interface A2AQuestionScope {
  kind: 'a2a_question';
  conversation_id: string;
  inbound_message_id: string;
  sender_did: string;
  // The specific agent the question was addressed to (a user may own several),
  // so the resume re-reads the right agent rather than an arbitrary one.
  agent_id: string;
  content: string;
  // The thread id the PEER used. Their conversation id, meaningless locally,
  // kept only so the reply can be addressed in terms they recognise.
  peer_thread_id?: string;
}

export interface HoldA2AQuestionParams {
  userId: string;
  agentId: string;
  peer: typeof peerAgents.$inferSelect;
  senderDid: string;
  conversationId: string;
  peerThreadId?: string;
  inboundMessageId: string;
  content: string;
}

// Record an inbound question from a connected peer as a pending `ask`
// permission for the owner to approve before the agent answers. The inbound
// message is already stored and broadcast by the caller; this only adds the
// approval gate.
export function holdA2AQuestion(params: HoldA2AQuestionParams): Promise<void> {
  const scope: A2AQuestionScope = {
    kind: 'a2a_question',
    conversation_id: params.conversationId,
    inbound_message_id: params.inboundMessageId,
    sender_did: params.senderDid,
    agent_id: params.agentId,
    content: params.content.slice(0, 500),
    peer_thread_id: params.peerThreadId,
  };

  return requestPeerPermission({
    userId: params.userId,
    peer: params.peer,
    action: 'ask',
    level: classifyPermissionLevel('ask'),
    scope,
  });
}

// Narrow a permission's scope_json to the held-question shape, or null if it's
// not an a2a_question scope (e.g. a connect request scope).
export function asA2AQuestionScope(scope: unknown): A2AQuestionScope | null {
  if (!scope || typeof scope !== 'object') return null;
  const s = scope as Record<string, unknown>;
  if (
    s.kind !== 'a2a_question' ||
    typeof s.conversation_id !== 'string' ||
    typeof s.inbound_message_id !== 'string' ||
    typeof s.sender_did !== 'string' ||
    typeof s.agent_id !== 'string'
  ) {
    return null;
  }
  return s as unknown as A2AQuestionScope;
}
