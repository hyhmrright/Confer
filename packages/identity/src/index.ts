export { MAX_CLOCK_SKEW_MS, signRequest, verifyRequestSignature } from './a2a/signature.js';
export { parseSignatureInput } from './a2a/structured-fields.js';
export type { AgentFacts } from './agent-facts/schema.js';
export { agentFactsSchema } from './agent-facts/schema.js';
export type { KeyPair } from './crypto/keypair.js';
export {
  exportPrivateKey,
  generateEd25519KeyPair,
  importPrivateKey,
  multibaseToPublicKey,
  publicKeyToMultibase,
} from './crypto/keypair.js';
export type { DIDDocument, DidWebLocation } from './did/document.js';
export { buildDIDDocument, didFromDomain, domainFromDid, parseDidWeb } from './did/document.js';
export { clearDIDCache, resolveDID } from './did/resolver.js';
export {
  assertNotLinkLocalHostname,
  assertPublicHostname,
  isBlockedIp,
  SsrfBlockedError,
  SsrfUnresolvedError,
} from './net/ssrf-guard.js';
