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

export function buildDIDDocument(domain: string, publicKeyMultibase: string): DIDDocument {
  const did = `did:web:${domain}`;
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    verificationMethod: [
      {
        id: `${did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: did,
        publicKeyMultibase,
      },
    ],
    // Declare the signing key's purpose so verifiers can enforce that this key
    // is authorized for authentication, not merely registered.
    authentication: [`${did}#key-1`],
    service: [
      {
        id: `${did}#confer-agent`,
        type: 'ConferAgent',
        serviceEndpoint: `https://${domain}/a2a/v1`,
      },
    ],
  };
}

export function didFromDomain(domain: string): string {
  return `did:web:${domain}`;
}

export function domainFromDid(did: string): string | null {
  const match = did.match(/^did:web:(.+)/);
  return match?.[1]?.split(':')[0] ?? null;
}
