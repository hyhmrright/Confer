import { err, ok, type Result } from '@confer/shared';
import {
  parseSignatureInput,
  parseSignatureValue,
  serializeContentDigest,
  serializeSignatureParams,
  serializeSignatureValue,
} from './structured-fields.js';

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// The signature algorithm is derived from the key type (Ed25519), never chosen
// by the `alg` parameter. We emit `alg="ed25519"` for RFC 9421 §3.3.7
// compliance and reject a mismatching value, but the value never selects the
// verification algorithm.
const SIGNATURE_ALG = 'ed25519';

// RFC 9530 Content-Digest value for a request body: `sha-256=:<base64>:`
// (lowercase algorithm name, colon-wrapped byte sequence).
export async function computeDigest(body: string): Promise<string> {
  const encoded = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return serializeContentDigest(b64);
}

// Build the RFC 9421 §2.5 signature base: one `"<component>": <value>` line per
// covered component in order, then a final `"@signature-params": <paramsValue>`
// line. `paramsValue` is the byte-exact serialization both signer and verifier
// agree on. Derived components map to the request; other identifiers map to the
// request header of the same (lowercased) name. A covered component whose value
// is absent is an error — the base cannot be reproduced.
export async function buildSignatureBase(
  request: Request,
  components: string[],
  paramsValue: string,
): Promise<Result<string, string>> {
  const url = new URL(request.url);
  const lines: string[] = [];

  for (const component of components) {
    let value: string | null;
    switch (component) {
      case '@method':
        value = request.method.toUpperCase();
        break;
      case '@authority':
        // URL normalizes the host to lowercase and strips the default port;
        // scheme-independent, so it survives a TLS-terminating proxy where
        // @target-uri would scheme-mismatch between signer and verifier.
        value = url.host;
        break;
      case '@path':
        value = url.pathname;
        break;
      case '@target-uri':
        value = url.href;
        break;
      default:
        value = request.headers.get(component);
        break;
    }
    if (value === null) {
      return err(`Signature covers ${component} but it is absent from the request`);
    }
    lines.push(`"${component}": ${value}`);
  }

  lines.push(`"@signature-params": ${paramsValue}`);
  return ok(lines.join('\n'));
}

export async function verifyRequestSignature(
  request: Request,
  publicKey: CryptoKey,
): Promise<Result<true, string>> {
  const sigInputHeader = request.headers.get('signature-input');
  if (!sigInputHeader) {
    return err('Missing Signature-Input header');
  }
  const sigHeader = request.headers.get('signature');
  if (!sigHeader) {
    return err('Missing Signature header');
  }

  const parsed = parseSignatureInput(sigInputHeader);
  if (!parsed.ok) {
    return parsed;
  }
  const { components, created, alg, paramsValue } = parsed.value;
  const covered = new Set(components);

  // Finding B (carried from the draft-cavage format onto RFC 9421 component
  // identifiers): a signature is only meaningful if it covers the request's
  // identity-bearing components. Without a mandated minimum an attacker can sign
  // a trivial set (e.g. just `date`), then swap the method/path/body afterwards
  // and still verify. Require @method, the request target (either @target-uri
  // or @path+@authority), and date; and — when the request carries a body —
  // require content-digest so the body is bound to the signature.
  if (!covered.has('@method')) {
    return err('Signature must cover @method');
  }
  const coversTarget =
    covered.has('@target-uri') || (covered.has('@path') && covered.has('@authority'));
  if (!coversTarget) {
    return err('Signature must cover @target-uri or both @path and @authority');
  }
  if (!covered.has('date')) {
    return err('Signature must cover date');
  }
  const body = await request.clone().text();
  if (body.length > 0 && !covered.has('content-digest')) {
    return err('Signature must cover content-digest for a request with a body');
  }

  // `alg`, when present, must name this scheme — but it never selects the
  // algorithm (Ed25519 stays key-derived). Absent is fine.
  if (alg !== undefined && alg !== SIGNATURE_ALG) {
    return err(`Unsupported signature algorithm: ${alg}`);
  }

  // Clock skew: the Date header (a mandatory covered component) and, when
  // present, the created parameter must both fall within the skew window.
  const dateHeader = request.headers.get('date');
  if (!dateHeader) {
    return err('Missing Date header (required for replay protection)');
  }
  const requestTime = new Date(dateHeader).getTime();
  if (Number.isNaN(requestTime)) {
    return err('Invalid Date header format');
  }
  if (Math.abs(Date.now() - requestTime) > MAX_CLOCK_SKEW_MS) {
    return err('Request date outside acceptable window');
  }
  if (created !== undefined && Math.abs(Date.now() - created * 1000) > MAX_CLOCK_SKEW_MS) {
    return err('Signature created outside acceptable window');
  }

  // Content-Digest match: recompute over the body and compare to the header
  // value when it is part of the covered set, binding the exact bytes signed.
  if (covered.has('content-digest')) {
    const digestHeader = request.headers.get('content-digest');
    if (!digestHeader) {
      return err('Content-Digest header referenced but missing');
    }
    const expected = await computeDigest(body);
    if (digestHeader !== expected) {
      return err('Content-Digest mismatch');
    }
  }

  const base = await buildSignatureBase(request, components, paramsValue);
  if (!base.ok) {
    return base;
  }

  const sigBytes = parseSignatureValue(sigHeader);
  if (!sigBytes.ok) {
    return sigBytes;
  }

  const valid = await crypto.subtle.verify(
    'Ed25519',
    publicKey,
    sigBytes.value,
    new TextEncoder().encode(base.value),
  );
  if (!valid) {
    return err('Signature verification failed');
  }

  return ok(true);
}

export async function signRequest(
  request: Request,
  privateKey: CryptoKey,
  keyId: string,
): Promise<Request> {
  const newHeaders = new Headers(request.headers);
  if (!newHeaders.has('date')) {
    newHeaders.set('date', new Date().toUTCString());
  }

  // Cover @method, @authority + @path (the scheme-independent request target),
  // then date. Content-Digest is added only when there is a body — a body-less
  // GET that declared content-digest would be rejected at verification. No Host
  // header is set: @authority is derived from the URL. (No query on the current
  // A2A endpoints; add @query if a query-bearing endpoint is introduced.)
  const components = ['@method', '@authority', '@path'];
  const body = await request.clone().text();
  if (body) {
    newHeaders.set('content-digest', await computeDigest(body));
    components.push('content-digest');
  }
  components.push('date');

  const signed = new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: body || undefined,
  });

  const created = Math.floor(Date.now() / 1000);
  const paramsValue = serializeSignatureParams(components, {
    keyid: keyId,
    created,
    alg: SIGNATURE_ALG,
  });

  const base = await buildSignatureBase(signed, components, paramsValue);
  if (!base.ok) {
    // Unreachable for the components assembled here (all derived or set above);
    // a failure would be a programming error in this function.
    throw new Error(`Failed to build signature base: ${base.error}`);
  }

  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    new TextEncoder().encode(base.value),
  );

  signed.headers.set('signature-input', `sig1=${paramsValue}`);
  signed.headers.set('signature', serializeSignatureValue(new Uint8Array(signature)));

  return signed;
}
