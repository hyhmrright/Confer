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
