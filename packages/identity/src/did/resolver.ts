import { err, ok, type Result } from '@confer/shared';
import { readCappedText } from '../net/read-capped.js';
import { assertPublicHostname, SsrfBlockedError, SsrfUnresolvedError } from '../net/ssrf-guard.js';
import type { DIDDocument } from './document.js';
import { didDocumentSchema, parseDidWeb } from './document.js';

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
// A DID document is a few keys and service entries — ours are under 1 KB. The
// host is whoever an unauthenticated request's keyid named, so neither how much
// it sends nor how long it takes to send it is left to that host.
const MAX_DOCUMENT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

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

  const loc = parseDidWeb(did);
  if (!loc) {
    return err(`Invalid DID format: ${did}`);
  }

  // SSRF guard: refuse a DID whose host resolves to a loopback / LAN / metadata
  // / reserved address. The guard receives only the bare hostname — never a
  // path — so a sub-identifier DID can't smuggle a private target past it.
  //
  // Loopback used to be exempt, for single-machine `did:web:localhost`
  // deployments. Those never reach here: the gateway answers its own DIDs from
  // its own database (`lib/did-resolution.ts`), so the exemption only ever
  // served a remote DID naming a port on our loopback.
  //
  // Every failure refuses, not just the two SSRF errors. A name that did not
  // resolve used to fall through on the grounds that the fetch would fail the
  // same way — but the fetch resolves the name again, and whoever runs that
  // name's DNS decides what the second answer is.
  try {
    await assertPublicHostname(loc.hostname);
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      return err(`Refusing to resolve DID pointing at a private address: ${did}`);
    }
    if (e instanceof SsrfUnresolvedError) {
      return err(`Refusing to resolve DID whose host did not resolve in time: ${did}`);
    }
    return err(`Refusing to resolve DID whose host does not resolve: ${did}`);
  }

  // Sub-identifier DIDs (path segments) resolve to `.../did.json` under their
  // path; bare-domain DIDs fall back to `/.well-known/did.json` (parseDidWeb).
  const url = loc.url;

  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    // The guard vetted this host, not wherever it redirects to: a followed
    // `302 Location: http://169.254.169.254/` went straight past it. A 3xx is
    // therefore a failure (`!response.ok` below), never a hop.
    //
    // The fetch still resolves the name a second time, so a record that
    // changes between the two lookups is not closed here. What contains it is
    // the scheme: this is https to the DID's own name, so an internal service
    // would have to present a valid certificate for that name before a byte of
    // the request reached it. That is also why the catch below returns no
    // exception text — "connection refused" against "handshake failed" is the
    // one thing such a rebinding could still learn.
    const response = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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

    const json: unknown = JSON.parse(await readCappedText(response, MAX_DOCUMENT_BYTES));
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
  } catch {
    // Reaches an unauthenticated caller verbatim, as the reason its request was
    // refused (`did_resolution_failed`) — see the comment on the fetch above.
    return err(`Failed to resolve DID ${did}`);
  }
}

export function clearDIDCache(): void {
  cache.clear();
}
