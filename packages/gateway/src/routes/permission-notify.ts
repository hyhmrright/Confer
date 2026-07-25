import type { WsServerMessage } from '@confer/shared';
import { sendToUser } from '../ws/handler.js';

// Leaf module (imports only ws/handler + shared types) so the shared
// `describePermission` helper and the real-time `permission.request` push can be
// reused by both `permissions.ts` (the `/pending` list) and `a2a.ts` (the
// insert sites) without risking an `a2a ↔ permissions` import cycle.

// The row fields needed to render a pending permission's inbox description.
// Shared source of truth so the `/pending` list and the live push produce an
// identical description string.
export interface PendingRow {
  action: string;
  scope_json: unknown;
  peer_name: string | null;
  peer_did: string | null;
}

// Build a human-readable description for the permission inbox. Connection
// requests surface who is asking and their opening message; a held A2A question
// surfaces the question text so the owner can decide whether to let the agent
// answer it.
export function describePermission(row: PendingRow): string {
  const who = row.peer_name ?? row.peer_did ?? '某个 Agent';
  if (row.action === 'connect') {
    const first = (row.scope_json as { first_message?: string } | null)?.first_message;
    return first
      ? `${who} 请求与你的 Agent 建立连接：“${first}”`
      : `${who} 请求与你的 Agent 建立连接`;
  }
  if (row.action === 'ask') {
    const content = (row.scope_json as { content?: string } | null)?.content;
    return content ? `${who} 向你的 Agent 提问：“${content}”` : `${who} 向你的 Agent 提问`;
  }
  return `${who} 请求执行：${row.action}`;
}

// A freshly-inserted pending permission, carrying the identity/level/timestamp
// fields the inbox card renders on top of the description inputs.
export interface NotifyPermissionRow extends PendingRow {
  id: string;
  level: string;
  created_at: Date;
}

// Push a newly-created pending permission to the owner's live sockets so the
// permission inbox updates in real time without a poll or refetch. Rides
// `sendToUser` (user-scoped, no conversation-subscription gate) — a per-user
// event does not belong behind a per-conversation subscription. The payload
// matches the documented `permission.request` shape (docs/05-api.md) and the
// client's `permissionRequestSchema`: no A2A request body, only the inbox
// description + already-stored scope.
export function notifyPermissionRequest(userId: string, row: NotifyPermissionRow): void {
  const message: WsServerMessage = {
    type: 'permission.request',
    data: {
      id: row.id,
      level: row.level,
      action: row.action,
      scope: row.scope_json,
      description: describePermission(row),
      requested_at: row.created_at.toISOString(),
    },
  };
  sendToUser(userId, message);
}
