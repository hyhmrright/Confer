import { z } from 'zod';

// A permission request as delivered over the `permission.request` WS event and
// embedded in a message's content_json. Rendered by PermissionCard. Shared so
// the WS listener (ChatLayout) and the message renderer (MessageBubble) validate
// against one definition.
export const permissionRequestSchema = z.object({
  id: z.string(),
  level: z.string(),
  action: z.string(),
  scope: z.record(z.unknown()),
  description: z.string(),
  requested_at: z.string(),
});

export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
