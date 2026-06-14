import { z } from 'zod';

export const peerAgentSchema = z.object({
  id: z.string().length(26),
  did: z.string(),
  name: z.string().max(128).optional(),
  description: z.string().optional(),
  avatar_url: z.string().url().optional(),
  organization: z.string().max(255).optional(),
  endpoint: z.string().url(),
  public_key_json: z.record(z.unknown()),
  agent_facts_json: z.record(z.unknown()),
  fetched_at: z.coerce.date(),
  etag: z.string().optional(),
  trust_level: z.enum(['unknown', 'verified', 'trusted', 'blocked']).default('unknown'),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export const peerContactSchema = z.object({
  id: z.string().length(26),
  user_id: z.string().length(26),
  peer_id: z.string().length(26),
  alias: z.string().max(128).optional(),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  muted: z.boolean().default(false),
  policy_overrides: z.record(z.unknown()).default({}),
  added_via: z.string().max(32).optional(),
  created_at: z.coerce.date(),
});

export const contactLookupSchema = z.object({
  method: z.enum(['domain', 'did', 'username', 'qr_code', 'phone']),
  value: z.string().min(1),
});

// Runtime per-contact policy override stored in `peer_contacts.policy_overrides_json`.
// This is the body shape for `POST /contacts/{id}/policies`. It mirrors the
// agent-runtime `PolicyConfig` vocabulary ({ default, rules:[{ action, peer_did?,
// decision }] }) — NOT the AgentFacts advertisement shape in `agent.ts`
// (`policyConfigSchema`), which deliberately stays separate per its do-not-bridge
// note. `default`/`rules` are both optional so an empty `{}` is a valid no-op
// override (equivalent to "use the agent-level default").
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

export type PeerAgent = z.infer<typeof peerAgentSchema>;
export type PeerContact = z.infer<typeof peerContactSchema>;
export type ContactLookup = z.infer<typeof contactLookupSchema>;
export type PolicyOverrides = z.infer<typeof policyOverridesSchema>;
