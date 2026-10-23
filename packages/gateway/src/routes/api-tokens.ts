import { AppError, createApiTokenRequestSchema, newId } from '@confer/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb } from '../db/connection.js';
import { apiTokens } from '../db/schema.js';
import { mintApiToken } from '../lib/api-tokens.js';
import { writeAudit } from '../lib/audit.js';
import { authMiddleware, requireSession } from '../middleware/auth.js';
import type { AppEnv } from '../types.js';

// The owner's personal API tokens. Managing them is session-only: a token that
// could mint more tokens, or revoke the owner's others, would outlive its own
// revocation.
export const apiTokenRoutes = new Hono<AppEnv>();

apiTokenRoutes.use('/*', authMiddleware, requireSession);

/** Enough for one per script or machine; a ceiling, so a loop cannot mint thousands. */
const MAX_TOKENS_PER_USER = 20;

const listed = {
  id: apiTokens.id,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  created_at: apiTokens.created_at,
  last_used_at: apiTokens.last_used_at,
  expires_at: apiTokens.expires_at,
};

apiTokenRoutes.get('/', async (c) => {
  const tokens = await getDb()
    .select(listed)
    .from(apiTokens)
    .where(eq(apiTokens.user_id, c.get('user').sub))
    .orderBy(desc(apiTokens.id));
  return c.json({ tokens });
});

// The token itself is in this response and nowhere else, ever.
apiTokenRoutes.post('/', async (c) => {
  const userId = c.get('user').sub;
  const body = createApiTokenRequestSchema.parse(await c.req.json());
  const db = getDb();

  const [held] = await db
    .select({ n: count() })
    .from(apiTokens)
    .where(eq(apiTokens.user_id, userId));
  if ((held?.n ?? 0) >= MAX_TOKENS_PER_USER) {
    throw new AppError('too_many_tokens', `At most ${MAX_TOKENS_PER_USER} tokens`, 409);
  }

  const { token, hash, prefix } = mintApiToken();
  const [row] = await db
    .insert(apiTokens)
    .values({
      id: newId(),
      user_id: userId,
      name: body.name,
      token_hash: hash,
      prefix,
      expires_at: body.expires_in_days
        ? new Date(Date.now() + body.expires_in_days * 86_400_000)
        : undefined,
    })
    .returning(listed);
  await writeAudit(c, 'account.api_token_created', { token_id: row?.id });
  return c.json({ token: { ...row, token } }, 201);
});

apiTokenRoutes.delete('/:id', async (c) => {
  const [removed] = await getDb()
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, c.req.param('id')), eq(apiTokens.user_id, c.get('user').sub)))
    .returning({ id: apiTokens.id });
  if (!removed) throw new AppError('not_found', 'Token not found', 404);
  await writeAudit(c, 'account.api_token_revoked', { token_id: removed.id });
  return c.json({ ok: true });
});
