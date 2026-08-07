import type { PermissionRequestEvent, WsServerMessage } from '@confer/shared';
import { sendToUser } from '../ws/handler.js';

// Leaf module (imports only ws/handler + shared types) so the `permission.request`
// payload builder and its real-time push can be reused by both `permissions.ts`
// (the `/pending` list) and `a2a.ts` (the insert sites) without risking an
// `a2a ↔ permissions` import cycle.

// The permission row fields the inbox needs, as read from the DB (with the
// `peerAgents` join). `scope_json` is `unknown` because it is a JSONB column;
// its per-action shape is the client's business to interpret.
export interface PendingRow {
  id: string;
  level: string;
  action: string;
  scope_json: unknown;
  peer_name: string | null;
  peer_did: string | null;
  created_at: Date;
  decision?: string | null;
}

// Build the wire payload for a pending permission. Structured facts only — no
// rendered sentence. The description the owner reads is composed client-side
// through i18n (`lib/permission-text.ts`), because the gateway has no locale
// context and this text sits on the security-critical approval path: an en/ja
// user must not be asked to approve a peer connection described in Chinese.
//
// The return type is `PermissionRequestEvent`, so the compiler already holds
// this to the shared contract. It deliberately does NOT re-validate at runtime:
// this payload is outbound, and a `.parse()` here would turn a formatting
// problem into a thrown request — one odd row would 400 the whole `/pending`
// list, blanking the owner's entire approval inbox, and on the inbound A2A path
// it would fail the request after the permission row had already been committed.
//
// `scope_json` is the one field the compiler cannot vouch for: it is a JSONB
// column typed `unknown`. Anything that is not a plain object becomes `{}`, so a
// malformed row degrades to a card with less detail rather than taking the list down.
export function toPermissionRequestEvent(row: PendingRow): PermissionRequestEvent {
  const scope = row.scope_json;
  return {
    id: row.id,
    level: row.level,
    action: row.action,
    scope:
      typeof scope === 'object' && scope !== null && !Array.isArray(scope)
        ? (scope as Record<string, unknown>)
        : {},
    peer_name: row.peer_name,
    peer_did: row.peer_did,
    requested_at: row.created_at.toISOString(),
    decision: row.decision ?? null,
  };
}

// Push a newly-created pending permission to the owner's live sockets so the
// permission inbox updates in real time without a poll or refetch. Rides
// `sendToUser` (user-scoped, no conversation-subscription gate) — a per-user
// event does not belong behind a per-conversation subscription.
export function notifyPermissionRequest(userId: string, row: PendingRow): void {
  const message: WsServerMessage<PermissionRequestEvent> = {
    type: 'permission.request',
    data: toPermissionRequestEvent(row),
  };
  sendToUser(userId, message);
}
