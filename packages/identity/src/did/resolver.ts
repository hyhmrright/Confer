import { type Result, err, ok } from '@confer/shared';
import { SsrfBlockedError, assertPublicHostname } from '../net/ssrf-guard.js';
import type { DIDDocument } from './document.js';
import { didDocumentSchema, domainFromDid } from './document.js';

interface CacheEntry {
  document: DIDDocument;
  etag?: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;
// Cap the honored max-age so a hostile origin can't pin a (possibly compromised)
// key document in our cache for weeks.
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

// Derive this resolution's cache TTL from the response's Cache-Control:
// - no-store / no-cache / max-age=0 → null (don't cache this result)
// - a positive max-age → that many seconds (capped at MAX_TTL_MS)
// - anything else / absent → the default TTL
function ttlFromCacheControl(header: string | null): number | null {
  if (!header) return TTL_MS;
  const lower = header.toLowerCase();
  if (lower.includes('no-store') || lower.includes('no-cache')) return null;
  const match = lower.match(/max-age=(\d+)/);
  if (!match?.[1]) return TTL_MS;
  const maxAgeMs = Number(match[1]) * 1000;
  if (maxAgeMs <= 0) return null;
  return Math.min(maxAgeMs, MAX_TTL_MS);
}

// Read from the cache and mark the entry most-recently-used (move to Map tail)
// so the LRU eviction in `cacheSet` sheds genuinely cold entries first.
function cacheGet(did: string): CacheEntry | undefined {
  const entry = cache.get(did);
  if (!entry) return undefined;
  cache.delete(did);
  cache.set(did, entry);
  return entry;
}

function cacheSet(did: string, entry: CacheEntry): void {
  // Evict the oldest (Map head) before inserting a brand-new key at capacity.
  if (!cache.has(did) && cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.delete(did);
  cache.set(did, entry);
}

export async function resolveDID(did: string): Promise<Result<DIDDocument, string>> {
  const cached = cacheGet(did);
  if (cached && Date.now() < cached.expiresAt) {
    return ok(cached.document);
  }

  const domain = domainFromDid(did);
  if (!domain) {
    return err(`Invalid DID format: ${did}`);
  }

  // SSRF guard: refuse a DID whose host resolves to a LAN / metadata / reserved
  // address. Loopback stays allowed because a single-machine deployment serves
  // its own agents at `did:web:localhost` (https://localhost/.well-known/did.json).
  // A DNS-resolution failure is not a block — the fetch below fails the same way
  // — so only a positively-resolved blocked address aborts here.
  try {
    await assertPublicHostname(domain, { allowLoopback: true });
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      return err(`Refusing to resolve DID pointing at a private address: ${did}`);
    }
  }

  const url = `https://${domain}/.well-known/did.json`;

  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    const response = await fetch(url, { headers });
    const ttl = ttlFromCacheControl(response.headers.get('cache-control'));

    if (response.status === 304 && cached) {
      // Keep serving the still-valid document; refresh its expiry with the
      // freshly negotiated TTL (or the default when the origin says don't-cache,
      // rather than dropping a document we just confirmed is unchanged).
      cached.expiresAt = Date.now() + (ttl ?? TTL_MS);
      return ok(cached.document);
    }

    if (!response.ok) {
      return err(`Failed to fetch DID document: HTTP ${response.status}`);
    }

    const json = await response.json();
    const parsed = didDocumentSchema.safeParse(json);
    if (!parsed.success) {
      return err(`Invalid DID document: ${parsed.error.message}`);
    }

    if (ttl !== null) {
      cacheSet(did, {
        document: parsed.data,
        etag: response.headers.get('etag') ?? undefined,
        expiresAt: Date.now() + ttl,
      });
    }

    return ok(parsed.data);
  } catch (e) {
    return err(`Failed to resolve DID ${did}: ${e}`);
  }
}

export function clearDIDCache(): void {
  cache.clear();
}
