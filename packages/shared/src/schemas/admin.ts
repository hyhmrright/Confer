import { z } from 'zod';

// Account role and lifecycle status values, shared by gateway (validation) and
// client (typing). Kept to a two-level model for the MVP admin backend.
export const userRoleSchema = z.enum(['member', 'admin']);
export const userStatusSchema = z.enum(['active', 'disabled']);

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

// Query params for the paginated admin user list. `q` matches username.
export const adminUserListQuerySchema = z.object({
  q: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;

// Body for PATCH /admin/users/:id. Either field may be supplied; at least one
// must be present (enforced by the handler). `role` toggles admin/member,
// `status` toggles active/disabled.
export const adminUpdateUserSchema = z
  .object({
    role: userRoleSchema.optional(),
    status: userStatusSchema.optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'At least one of role or status is required',
  });

export type AdminUpdateUser = z.infer<typeof adminUpdateUserSchema>;

// --- 3b: content moderation -------------------------------------------------

// Agent moderation lifecycle. 'suspended' soft-removes an agent from public
// discovery (read-path filtering only — AgentFacts/DID untouched).
export const agentStatusSchema = z.enum(['active', 'suspended']);
export type AgentStatus = z.infer<typeof agentStatusSchema>;

// Conversation/message admin visibility. 'hidden' filters from non-admin reads.
export const moderationStatusSchema = z.enum(['visible', 'hidden']);
export type ModerationStatus = z.infer<typeof moderationStatusSchema>;

// Shared pagination query for admin list endpoints (agents, conversations).
export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

// Body for PATCH /admin/agents/:id — suspend or restore an agent.
export const adminUpdateAgentSchema = z.object({
  status: agentStatusSchema,
  reason: z.string().max(500).optional(),
});
export type AdminUpdateAgent = z.infer<typeof adminUpdateAgentSchema>;

// Body for PATCH /admin/conversations/:id and PATCH /admin/messages/:id —
// hide or restore content.
export const adminModerateSchema = z.object({
  moderation_status: moderationStatusSchema,
  reason: z.string().max(500).optional(),
});
export type AdminModerate = z.infer<typeof adminModerateSchema>;

// --- 3c: global config ------------------------------------------------------

// The full set of admin-editable global config (MVP minimal set). Both fields
// optional on PATCH; the handler applies whichever are present.
export const appConfigSchema = z.object({
  registration_open: z.boolean(),
  instance_name: z.string().min(1).max(128),
});
export type AppConfigValues = z.infer<typeof appConfigSchema>;

export const adminUpdateConfigSchema = z
  .object({
    registration_open: z.boolean().optional(),
    instance_name: z.string().min(1).max(128).optional(),
  })
  .refine((v) => v.registration_open !== undefined || v.instance_name !== undefined, {
    message: 'At least one config field is required',
  });
export type AdminUpdateConfig = z.infer<typeof adminUpdateConfigSchema>;
