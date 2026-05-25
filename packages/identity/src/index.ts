export { buildDIDDocument, didFromDomain, domainFromDid } from './did/document.js';
export type { DIDDocument } from './did/document.js';
export { resolveDID, clearDIDCache } from './did/resolver.js';
export { parseSignatureHeader, verifyRequestSignature, signRequest } from './a2a/signature.js';
export type { SignatureParams } from './a2a/signature.js';
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
