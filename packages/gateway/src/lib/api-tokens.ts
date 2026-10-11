import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import { apiTokens, users } from '../db/schema.js';
import { runDetached } from './background.js';

// What an API token looks like on the wire. The prefix is how the middleware
// tells one from a session JWT without trying to parse it, and how a token
// that leaks into a log or a repository is recognisable for what it is.
export const API_TOKEN_PREFIX = 'cfr_';

/** A new token, and the hash and display prefix that are all the server keeps. */
export function mintApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 12) };
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Whose token this is, if it is a live one and its owner is not disabled. */
export async function resolveApiToken(
  token: string,
): Promise<{ userId: string; username: string; tokenId: string } | null> {
  const [row] = await getDb()
    .select({
      tokenId: apiTokens.id,
      userId: users.id,
      username: users.username,
      status: users.status,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.user_id))
    .where(
      and(
        eq(apiTokens.token_hash, hashApiToken(token)),
        or(isNull(apiTokens.expires_at), gt(apiTokens.expires_at, new Date())),
      ),
    )
    .limit(1);
  if (!row || row.status === 'disabled') return null;

  // "Last used" is for the owner deciding what to revoke, so minute precision
  // is plenty — and it keeps a busy script from writing a row per request.
  const now = new Date();
  runDetached(
    getDb()
      .update(apiTokens)
      .set({ last_used_at: now })
      .where(
        and(
          eq(apiTokens.id, row.tokenId),
          or(
            isNull(apiTokens.last_used_at),
            lt(apiTokens.last_used_at, new Date(now.getTime() - 60_000)),
          ),
        ),
      ),
    (e) => console.error('api token last_used_at update failed:', e),
  );
  return { userId: row.userId, username: row.username, tokenId: row.tokenId };
}
