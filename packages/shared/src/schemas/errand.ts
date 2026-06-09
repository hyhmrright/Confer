import { z } from 'zod';

// Idea A — outbound delegate-assistant errand subsystem. An errand is a chore the
// owner delegates; while it runs, a WoZ operator pushes a decision card whenever
// owner judgment is needed (approve / change_price / reject). This is the
// OUTBOUND direction (the owner's own agent pauses to ask the owner) and is fully
// separate from the inbound connection-consent permissions subsystem.

export const errandStatusSchema = z.enum(['in_progress', 'done', 'cancelled']);

// Card semantics. `approve` gates a straightforward go/no-go; `change_price`
// carries a price delta the owner can accept or counter; `info` is a non-blocking
// notice (no money/commitment).
export const errandCardKindSchema = z.enum(['approve', 'change_price', 'info']);

// Owner decision on a card. `change_price` requires a counter `new_price`.
export const cardDecisionSchema = z.enum(['approve', 'change_price', 'reject']);

// Prices are integer cents in a single currency (default USD) — never floats.
const currencySchema = z.string().length(3).toUpperCase();
const centsSchema = z.number().int();

// External input: create an errand. Used by both the WoZ operator (acting for the
// owner) and the owner self-creating from the client.
export const createErrandSchema = z.object({
  title: z.string().min(1).max(255),
  kind: z.string().max(64).optional(),
  conversation_id: z.string().length(26).optional(),
});

// External input: a WoZ operator pushes a decision card onto an errand.
export const pushCardSchema = z
  .object({
    kind: errandCardKindSchema,
    summary: z.string().min(1).max(4000),
    currency: currencySchema.default('USD'),
    // Original price and delta in cents (delta may be negative for a discount).
    base_price_cents: centsSchema.optional(),
    price_delta_cents: centsSchema.optional(),
    // Whether this decision is strictly necessary (vs nice-to-have) — feeds the
    // "is the card nagging?" measurement.
    strictly_necessary: z.boolean().default(true),
    // How long the owner has to decide. Must be in the future.
    expires_at: z.coerce.date(),
  })
  .refine((v) => v.expires_at.getTime() > Date.now(), {
    message: 'expires_at must be in the future',
    path: ['expires_at'],
  })
  .refine((v) => v.kind !== 'change_price' || v.base_price_cents !== undefined, {
    message: 'change_price cards require base_price_cents',
    path: ['base_price_cents'],
  });

// External input: the owner decides on a card. A change_price decision must carry
// the owner's counter price in cents.
export const decideCardSchema = z
  .object({
    decision: cardDecisionSchema,
    new_price_cents: centsSchema.optional(),
  })
  .refine((v) => v.decision !== 'change_price' || v.new_price_cents !== undefined, {
    message: 'change_price decision requires new_price_cents',
    path: ['new_price_cents'],
  });

export type ErrandStatus = z.infer<typeof errandStatusSchema>;
export type ErrandCardKind = z.infer<typeof errandCardKindSchema>;
export type CardDecision = z.infer<typeof cardDecisionSchema>;
export type CreateErrandRequest = z.infer<typeof createErrandSchema>;
export type PushCardRequest = z.infer<typeof pushCardSchema>;
export type DecideCardRequest = z.infer<typeof decideCardSchema>;
