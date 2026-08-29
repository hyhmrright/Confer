import { z } from 'zod';
import { LLM_PROVIDER_IDS } from '../llm/catalog.js';

/**
 * What `agents.model_config_json` actually holds.
 *
 * It used to be described here as four named roles — brain / quick /
 * translation / summarize, each a provider+model pair, each with a hardcoded
 * vendor default. No screen has ever written that, and nothing has ever read
 * it: the settings UI saves `{provider, model, system_prompt}` flat, and
 * `resolveAgentModel` reads exactly those. The role-based version was a design
 * that never shipped, left behind as a schema, and because nothing imported it
 * nothing ever disagreed with it — which is also how its vendor list drifted
 * thirteen entries behind the catalogue before anyone noticed.
 *
 * Every field is optional because a half-configured agent is an ordinary state:
 * `resolveAgentModel` reports `no_model_configured` for it rather than treating
 * it as invalid input. The provider, when given, is asked of the catalogue —
 * the same check `routes/users.ts` runs when a key is stored for one.
 */
export const agentModelConfigSchema = z.object({
  provider: z
    .string()
    .refine((id) => id === '' || LLM_PROVIDER_IDS.includes(id), 'Unknown provider')
    .optional(),
  model: z.string().max(128).optional(),
  system_prompt: z.string().max(8000).optional(),
});

/** Body of `PATCH /api/v1/agents/me`. Absent fields are left as they were. */
export const updateAgentRequestSchema = z.object({
  name: z.string().max(128).nullish(),
  description: z.string().max(4000).nullish(),
  avatar_url: z.string().max(2048).nullish(),
  // Not nullable: the column is NOT NULL with a default, so "clear it" has no
  // meaning — there is always a language, and this is the only way to change it.
  primary_language: z.string().max(8).optional(),
  style: z.enum(['formal', 'friendly', 'technical', 'casual']).nullish(),
  model_config_json: agentModelConfigSchema.optional(),
  capabilities_json: z.array(z.record(z.string(), z.unknown())).max(64).optional(),
  is_public: z.boolean().optional(),
});

// Three more schemas stood here and are gone, all for the same reason: nothing
// imported them, and each described a shape the product does not have.
//
// `agentSchema` + `capabilitySchema` mirrored the `agents` table row. The
// gateway reads that table through Drizzle, which derives the row type from
// `db/schema.ts`; a hand-written second opinion about the same columns can only
// drift from it, and this one had — it embedded the role-based model config
// replaced above.
//
// `policyConfigSchema` + `policyRuleSchema` described an AgentFacts policy
// ADVERTISEMENT — `{ peer, action, pattern, effect }` — carrying a standing
// warning that it must never be fed into the runtime policy shape
// (`{ action, peer_did?, decision }` in agent-runtime) without reconciling the
// two vocabularies. But `/a2a/v1/agent-facts/:did` publishes no policies at
// all, so the advertisement has never existed and the hazard it warned about
// could not arise. One vocabulary is left, in the package that evaluates it.
