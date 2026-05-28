import { z } from 'zod';

export const didDocumentSchema = z.object({
  '@context': z.array(z.string()),
  id: z.string(),
  verificationMethod: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      controller: z.string(),
      publicKeyMultibase: z.string(),
    }),
  ),
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
