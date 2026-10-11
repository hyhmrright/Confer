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

// The second step, for an account with two-step sign-in on: an authenticator
// code, or one of the recovery codes issued when it was turned on.
const secondFactorSchema = {
  totp_code: z.string().max(16).optional(),
  recovery_code: z.string().max(32).optional(),
};

export const loginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  device_id: z.string().max(64),
  device_info: deviceInfoSchema,
  ...secondFactorSchema,
});

/**
 * Body of `POST /api/v1/auth/password`. Same length rule as registration; with
 * two-step sign-in on, a second factor too.
 */
export const changePasswordRequestSchema = z.object({
  current_password: z.string().max(128),
  new_password: z.string().min(8).max(128),
  ...secondFactorSchema,
});

/**
 * Body of `POST /api/v1/auth/2fa/enable`: the password, and a code from the
 * newly added app. The password because a stolen token alone must not be able
 * to put the attacker's authenticator between the owner and their account.
 */
export const enableTwoFactorRequestSchema = z.object({
  password: z.string().max(128),
  code: z.string().max(16),
});

/** Body of `POST /api/v1/auth/2fa/disable`: the password and a second factor. */
export const disableTwoFactorRequestSchema = z.object({
  password: z.string().max(128),
  ...secondFactorSchema,
});

/**
 * Body of `PATCH /api/v1/users/me`. Absent fields are left as they were; an
 * explicit null clears one, which is how the settings screen empties a field.
 *
 * The route allow-listed the field NAMES and then wrote whatever value came
 * with them. So a display name past 128 characters, or an `email` that is not
 * an address, reached the column and came back as a 500 from Postgres — an
 * internal error for what is plainly a bad request. The caps here are the
 * columns' own widths.
 */
export const updateProfileRequestSchema = z.object({
  display_name: z.string().max(128).nullish(),
  email: z.email().max(255).nullish(),
  phone: z.string().max(32).nullish(),
  avatar_url: z.string().max(2048).nullish(),
  preferences_json: z.record(z.string(), z.unknown()).optional(),
});
