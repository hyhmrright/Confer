import { type Result, err, ok } from '@confer/shared';
import type { DIDDocument } from './document.js';
import { didDocumentSchema, domainFromDid } from './document.js';

interface CacheEntry {
  document: DIDDocument;
  etag?: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function resolveDID(did: string): Promise<Result<DIDDocument, string>> {
  const cached = cache.get(did);
  if (cached && Date.now() < cached.expiresAt) {
    return ok(cached.document);
  }

  const domain = domainFromDid(did);
  if (!domain) {
    return err(`Invalid DID format: ${did}`);
  }

  const url = `https://${domain}/.well-known/did.json`;

  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    const response = await fetch(url, { headers });

    if (response.status === 304 && cached) {
      cached.expiresAt = Date.now() + TTL_MS;
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

    cache.set(did, {
      document: parsed.data,
      etag: response.headers.get('etag') ?? undefined,
      expiresAt: Date.now() + TTL_MS,
    });

    return ok(parsed.data);
  } catch (e) {
    return err(`Failed to resolve DID ${did}: ${e}`);
  }
}

export function clearDIDCache(): void {
  cache.clear();
}
