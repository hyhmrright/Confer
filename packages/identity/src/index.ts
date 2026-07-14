export { buildDIDDocument, didFromDomain, domainFromDid, parseDidWeb } from './did/document.js';
export type { DIDDocument, DidWebLocation } from './did/document.js';
export { resolveDID, clearDIDCache } from './did/resolver.js';
export { verifyRequestSignature, signRequest, MAX_CLOCK_SKEW_MS } from './a2a/signature.js';
export { parseSignatureInput } from './a2a/structured-fields.js';
export { agentFactsSchema } from './agent-facts/schema.js';
export type { AgentFacts } from './agent-facts/schema.js';
export {
  generateEd25519KeyPair,
  publicKeyToMultibase,
  multibaseToPublicKey,
  exportPrivateKey,
  importPrivateKey,
} from './crypto/keypair.js';
export type { KeyPair } from './crypto/keypair.js';
export { assertPublicHostname, isBlockedIp, SsrfBlockedError } from './net/ssrf-guard.js';
