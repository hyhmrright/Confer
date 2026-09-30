import { and, count, eq, gte, lt, type SQL, sql, sum } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { llmUsage } from '../db/schema.js';
import { authMiddleware } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

export const usageRoutes = new Hono<AppEnv>();

usageRoutes.use('/*', authMiddleware);

const querySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
});

// Months are UTC. An owner west of Greenwich sees their evening turns on the
// 1st counted in the month before; the alternative is a timezone the gateway
// does not know.
function monthRange(month: string | undefined): { month: string; from: Date; to: Date } {
  const now = new Date();
  const [year, index] = month
    ? [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1]
    : [now.getUTCFullYear(), now.getUTCMonth()];
  const from = new Date(Date.UTC(year, index, 1));
  const to = new Date(Date.UTC(year, index + 1, 1));
  return { month: from.toISOString().slice(0, 7), from, to };
}

// `sum` comes back as a numeric string (or null for an empty group).
const total = (column: Parameters<typeof sum>[0]) => sum(column).mapWith(Number);

const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

// The caller's agent turns for one month, grouped by what ran them and who they
// answered. Token sums leave out turns whose vendor reported no usage; those are
// counted separately as `unreported`, so the panel can say its totals are a
// floor rather than presenting them as the whole bill.
usageRoutes.get('/', async (c) => {
  const user = c.get('user');
  const { month, from, to } = monthRange(querySchema.parse(c.req.query()).month);

  const rows = await getDb()
    .select({
      provider: llmUsage.provider,
      model: llmUsage.model,
      audience: llmUsage.audience,
      turns: count(),
      unreported: countWhere(sql`${llmUsage.input_tokens} is null`),
      failed: countWhere(sql`${llmUsage.error_type} is not null`),
      input_tokens: total(llmUsage.input_tokens),
      output_tokens: total(llmUsage.output_tokens),
      cache_read_tokens: total(llmUsage.cache_read_tokens),
      cache_write_tokens: total(llmUsage.cache_write_tokens),
    })
    .from(llmUsage)
    .where(
      and(
        eq(llmUsage.user_id, user.sub),
        gte(llmUsage.created_at, from),
        lt(llmUsage.created_at, to),
      ),
    )
    .groupBy(llmUsage.provider, llmUsage.model, llmUsage.audience);

  return c.json({ month, rows });
});
