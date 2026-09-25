import { z } from 'zod';

export const permissionDecisionScopeSchema = z.enum(['peer', 'peer_action', 'global']);

export const decidePermissionRequestSchema = z.object({
  decision: z.enum(['allow_once', 'allow_always', 'deny', 'deny_always']),
  scope: permissionDecisionScopeSchema,
});

// The wire shape of a pending permission, used by BOTH the `permission.request`
// WS event and every row of `GET /permissions/pending` (docs/05-api.md). This is
// the single owner of that contract: the gateway parses outbound payloads with
// it and the client parses inbound ones, so a drift is a type error rather than
// a silent field loss.
//
// Deliberately carries no rendered sentence. The server has no idea what
// language the reader speaks, so it ships structured facts (`action`, the peer's
// identity, and the `scope` it already stores) and the client renders the
// description through i18n. Fields are loose strings, not enums, because the
// inbox must still render an `action` a newer gateway invented.
export const permissionRequestEventSchema = z.object({
  id: z.string(),
  level: z.string(),
  action: z.string(),
  scope: z.record(z.string(), z.unknown()),
  // nullish, not nullable: a peer with no name sends `null`, but a producer that
  // omits the key entirely must not make the whole card fail to parse and vanish.
  peer_name: z.string().nullish(),
  peer_did: z.string().nullish(),
  requested_at: z.string(),
  // Always 'pending' or null in practice — a decided request is not pending. The
  // live push carries it too (as null), so the list and socket paths stay one type.
  decision: z.string().nullish(),
});

export type PermissionRequestEvent = z.infer<typeof permissionRequestEventSchema>;
