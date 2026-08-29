import {
  MAX_CLOCK_SKEW_MS,
  multibaseToPublicKey,
  parseSignatureInput,
  verifyRequestSignature,
} from '@confer/identity';
import { AppError } from '@confer/shared';
import type { MiddlewareHandler } from 'hono';
import { resolveDidDocument } from '../lib/did-resolution.js';
import { addNonce, hasNonce } from '../lib/nonce-cache.js';

// A DID `authentication` entry is either a bare string reference to a
// verification method id or an embedded verification-method object; the key is
// authorized if it matches either form.
function authenticationAllows(
  authentication: ReadonlyArray<string | { id: string }>,
  keyId: string,
): boolean {
  return authentication.some((entry) =>
    typeof entry === 'string' ? entry === keyId : entry.id === keyId,
  );
}

/**
 * Contract 1: every `/a2a/v1/*` request carries a verified HTTP signature.
 *
 * On success the cryptographically proven signer DID is put on the context as
 * `a2aSenderDid`, so a handler can check that the message's `from` is not
 * forged under another identity.
 */
export const verifyA2ASignature: MiddlewareHandler = async (c, next) => {
  const sigInputHeader = c.req.header('signature-input');
  if (!sigInputHeader) {
    throw new AppError('signature_missing', 'Signature-Input header is required', 401);
  }

  const parsed = parseSignatureInput(sigInputHeader);
  if (!parsed.ok) {
    throw new AppError('signature_invalid', parsed.error, 401);
  }

  const keyId = parsed.value.keyid;
  const didMatch = keyId.match(/^(did:web:[^#]+)/);
  const senderDid = didMatch?.[1];
  if (!senderDid) {
    throw new AppError('signature_invalid', 'Invalid keyId format in signature', 401);
  }

  const didResult = await resolveDidDocument(senderDid);
  if (!didResult.ok) {
    throw new AppError('did_resolution_failed', didResult.error, 401);
  }

  const didDoc = didResult.value;
  const vm = didDoc.verificationMethod.find((m) => m.id === keyId);
  if (!vm) {
    throw new AppError('key_not_found', `Key ${keyId} not found in DID document`, 401);
  }

  // Finding E: registration in `verificationMethod` is not authorization to sign
  // for authentication. When the document declares an `authentication`
  // relationship, the key must be listed there. Documents that predate this
  // field (no `authentication` array) keep the legacy behavior — a registered
  // key is accepted — so minimal third-party docs and our own aren't broken.
  if (didDoc.authentication && !authenticationAllows(didDoc.authentication, keyId)) {
    throw new AppError(
      'key_not_authorized',
      `Key ${keyId} is not authorized for authentication`,
      401,
    );
  }

  const keyResult = await multibaseToPublicKey(vm.publicKeyMultibase);
  if (!keyResult.ok) {
    throw new AppError('key_invalid', keyResult.error, 401);
  }

  const verifyResult = await verifyRequestSignature(c.req.raw, keyResult.value);
  if (!verifyResult.ok) {
    throw new AppError('signature_failed', verifyResult.error, 401);
  }

  // Finding C: reject a byte-identical replay of an already-verified signature
  // within the clock-skew window. Ed25519 is deterministic and Finding B binds
  // the signature to method+authority+path+date+content-digest, so the Signature
  // header value uniquely identifies this request. Checked only AFTER
  // cryptographic verification so forged/invalid signatures never consume cache
  // space, and recorded with TTL = the skew window since anything older is
  // already rejected by the skew check.
  const nonceKey = `${keyId}:${c.req.header('signature')}`;
  if (hasNonce(nonceKey)) {
    throw new AppError('signature_replayed', 'This signed request has already been processed', 401);
  }
  addNonce(nonceKey, MAX_CLOCK_SKEW_MS);

  // Expose the cryptographically proven signer DID so the handler can ensure
  // the message `from` isn't forged under another identity.
  c.set('a2aSenderDid' as never, senderDid as never);

  await next();
};
