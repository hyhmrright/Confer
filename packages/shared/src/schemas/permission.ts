import { z } from 'zod';

export const permissionLevelSchema = z.enum(['L1', 'L2', 'L3']);

export const permissionDecisionSchema = z.enum(['allow_once', 'allow_always', 'deny', 'pending']);

export const permissionDecisionScopeSchema = z.enum(['peer', 'peer_action', 'global']);

export const permissionSchema = z.object({
  id: z.string().length(26),
  user_id: z.string().length(26),
  peer_id: z.string().length(26).optional(),
  action: z.string().max(64),
  scope_json: z.record(z.unknown()),
  level: permissionLevelSchema,
  decision: permissionDecisionSchema.optional(),
  decision_scope: permissionDecisionScopeSchema.optional(),
  requested_by: z.string().length(26).optional(),
  decided_by: z.string().length(26).optional(),
  expires_at: z.coerce.date().optional(),
  created_at: z.coerce.date(),
  decided_at: z.coerce.date().optional(),
});

export const decidePermissionRequestSchema = z.object({
  decision: z.enum(['allow_once', 'allow_always', 'deny', 'deny_always']),
  scope: permissionDecisionScopeSchema,
});

export type Permission = z.infer<typeof permissionSchema>;
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;
export type DecidePermissionRequest = z.infer<typeof decidePermissionRequestSchema>;
