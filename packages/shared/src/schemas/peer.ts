import { z } from 'zod';

export const contactLookupSchema = z.object({
  method: z.enum(['domain', 'did', 'username', 'qr_code', 'phone']),
  value: z.string().min(1),
});

// Runtime per-contact policy override stored in `peer_contacts.policy_overrides_json`.
// This is the body shape for `POST /contacts/{id}/policies`. It mirrors the
// agent-runtime `PolicyConfig` vocabulary ({ default, rules:[{ action, peer_did?,
// decision }] }), which since the AgentFacts advertisement shape was deleted from
// `agent.ts` is the only policy vocabulary there is. `default`/`rules` are both
// optional so an empty `{}` is a valid no-op override (equivalent to "use the
// agent-level default").
export const policyOverridesSchema = z.object({
  default: z.enum(['allow', 'ask_user', 'deny']).optional(),
  rules: z
    .array(
      z.object({
        action: z.string(),
        peer_did: z.string().optional(),
        decision: z.enum(['allow', 'ask_user', 'deny']),
      }),
    )
    .optional(),
});

export type PolicyOverrides = z.infer<typeof policyOverridesSchema>;
