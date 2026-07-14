import { z } from 'zod';

const verificationMethodObjectSchema = z.object({
  id: z.string(),
  type: z.string(),
  controller: z.string(),
  publicKeyMultibase: z.string(),
});

// A verification relationship (W3C DID Core v1.0 §5.3) lists keys authorized for
// a given purpose. Each entry is either a bare string reference to a
// verification method's id or an embedded verification-method object.
const verificationRelationshipSchema = z.array(
  z.union([z.string(), verificationMethodObjectSchema]),
);

export const didDocumentSchema = z.object({
  '@context': z.array(z.string()),
  id: z.string(),
  verificationMethod: z.array(verificationMethodObjectSchema),
  // Optional so minimal third-party documents (and our own pre-existing ones)
  // still resolve — the resolver `safeParse`s every fetched doc, so a required
  // field here would break resolution. Present when a document declares which
  // keys are authorized for authentication / assertion / capability invocation.
  authentication: verificationRelationshipSchema.optional(),
  assertionMethod: verificationRelationshipSchema.optional(),
  capabilityInvocation: verificationRelationshipSchema.optional(),
  service: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        serviceEndpoint: z.string(),
      }),
    )
    .optional(),
});

export type DIDDocument = z.infer<typeof didDocumentSchema>;

// Where a did:web identifier resolves: the bare `hostname` (for the SSRF/DNS
// check — never carries a path) and the fully qualified `url` of its DID
// document.
export interface DidWebLocation {
  hostname: string;
  url: string;
}

// Map a did:web identifier to its document URL per the W3C-CCG did:web Read
// (Resolve) algorithm. The method-specific id is a `:`-delimited list: the
// first segment is the authority (a `%3A`-encoded port is decoded here), the
// rest are path segments. With path segments the URL is
// `https://<authority>/<path>/did.json`; with none it falls back to
// `https://<authority>/.well-known/did.json`. A bare colon segment (e.g.
// `did:web:example.com:8080`) is a PATH segment, not a port — only a
// `%3A`-encoded colon in the authority is a port. Returns null for malformed or
// non-did:web input.
export function parseDidWeb(did: string): DidWebLocation | null {
  const match = did.match(/^did:web:(.+)$/);
  if (!match?.[1]) return null;
  try {
    const segments = match[1].split(':');
    const authority = decodeURIComponent(segments[0] ?? '');
    if (!authority) return null;
    const pathSegments = segments.slice(1).map(decodeURIComponent);
    const path = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/.well-known';

    // Percent-decoding the authority ahead of URL construction means a
    // segment like `public.example.com%40169.254.169.254` decodes to
    // `public.example.com@169.254.169.254` — a userinfo-smuggled host. Parse
    // the whole thing through `new URL()` (the same parser `fetch` uses) and
    // always derive `hostname` from the RESULT, never from the raw decoded
    // authority string, so the SSRF guard and the actual connect target can
    // never diverge. Reject embedded userinfo outright rather than trying to
    // blocklist individual smuggling characters — `did:web` authorities never
    // legitimately carry a username/password.
    const url = new URL(`https://${authority}${path}/did.json`);
    if (url.username || url.password) return null;
    return { hostname: url.hostname, url: url.href };
  } catch {
    // A malformed percent sequence or an unparseable URL — treat as malformed
    // input rather than propagating.
    return null;
  }
}

export interface BuildDIDDocumentParams {
  did: string;
  serviceEndpoint: string;
  // Omit when no active signing key exists yet (e.g. during a key-rotation gap):
  // `verificationMethod` and `authentication` come back empty, `service` stays.
  key?: { keyId: string; publicKeyMultibase: string };
}

export function buildDIDDocument({
  did,
  serviceEndpoint,
  key,
}: BuildDIDDocumentParams): DIDDocument {
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: key
      ? [
          {
            id: key.keyId,
            type: 'Ed25519VerificationKey2020',
            controller: did,
            publicKeyMultibase: key.publicKeyMultibase,
          },
        ]
      : [],
    // Declare the signing key's purpose so verifiers can enforce that this key
    // is authorized for authentication, not merely registered.
    authentication: key ? [key.keyId] : [],
    service: [
      {
        id: `${did}#confer-agent`,
        type: 'ConferAgent',
        serviceEndpoint,
      },
    ],
  };
}

export function didFromDomain(domain: string): string {
  return `did:web:${domain}`;
}

export function domainFromDid(did: string): string | null {
  return parseDidWeb(did)?.hostname ?? null;
}
