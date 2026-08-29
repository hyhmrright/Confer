import { z } from 'zod';

// This file once also carried `userSchema`, and under it `llmKeysSchema` with
// one optional field per vendor: openai, anthropic, deepseek, qwen. Nothing
// imported any of it, which is exactly why it was still naming four vendors
// while `llm/catalog.ts` had grown to eighteen — a second copy of a list that
// nothing validates against drifts silently and forever.
//
// It is deleted rather than pointed at the catalogue, because pointing it at
// the catalogue would still be wrong: the column it claimed to describe
// (`users.llm_keys_json`) also holds the `tavily` search key, so an accurate
// key type is LLM_PROVIDER_IDS *plus* the tool providers — which is precisely
// the union `routes/users.ts` already builds and validates against on the live
// path. Restating it here would have made a third copy while fixing the second.

// Register and login both open a session, so both describe the device it
// belongs to the same way.
const deviceInfoSchema = z
  .object({
    platform: z.string().optional(),
    model: z.string().optional(),
    os: z.string().optional(),
  })
  .optional();

export const registerRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9_-]+$/),
  email: z.string().email().optional(),
  password: z.string().min(8).max(128),
  display_name: z.string().max(128).optional(),
  // Register now creates a backing session (mirroring login) so its tokens can
  // be revoked/rotated, which requires the device the session belongs to.
  device_id: z.string().max(64),
  device_info: deviceInfoSchema,
});

export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  device_id: z.string().max(64),
  device_info: deviceInfoSchema,
});
