import { newId } from '@confer/shared';
import type { Context } from 'hono';
import { getDb } from '../db/connection.js';
import { auditLog } from '../db/schema.js';
import type { AppEnv } from '../types.js';
import { clientIp } from './client-ip.js';

// The audit_log.ip_address column is Postgres `inet`; anything that is not a
// valid IPv4/IPv6 literal (e.g. `unknown` when no proxy header reached us) is
// dropped to null rather than failing the write.
function toInet(value: string): string | null {
  const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
  const isIPv6 = value.includes(':');
  return isIPv4 || isIPv6 ? value : null;
}

// Record a security-relevant write: an admin's, or an owner's own account
// change. Actor and client IP both come off the request
// context, so no call site has to remember to thread them through. Stores only
// ids/flags in details_json — never PII (per the forbidden list).
//
// The IP comes from `clientIp`, the same resolution the rate limiter uses. This
// read `x-forwarded-for.split(',')[0]` — the first hop, which any caller can
// prepend to the header — so an admin acting through a proxy of their choosing
// could write whatever address they liked into the record of what they did.
export async function writeAudit(
  c: Context<AppEnv>,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .insert(auditLog)
    .values({
      id: newId(),
      user_id: c.get('user').sub,
      action,
      details_json: details,
      ip_address: toInet(clientIp(c)),
    });
}
