import { err, ok, type Result } from '@confer/shared';

// Minimal RFC 8941 structured-fields helpers, scoped to exactly the subset the
// A2A RFC 9421 wire format needs: a single-member dictionary labelled `sig1`
// whose value is an inner-list-of-strings with `keyid`/`created`/`alg`
// parameters (Signature-Input), a byte-sequence value (Signature), and the
// RFC 9530 Content-Digest form. We are today the sole producer and consumer of
// this format, so this deliberately does NOT implement the full 8941 grammar
// (nested dicts, booleans, decimals, tokens, per-item params in lists). If a
// third-party peer ever requires strict interop, swap this for a maintained
// structured-headers library — see the plan's dependency rationale.

// The one signature label this scoped format emits and accepts. Multi-signature
// dictionaries (more than one member) are explicitly rejected as out of scope.
const LABEL = 'sig1';

// Parameters carried on a Signature-Input member. `alg` is emitted for RFC 9421
// §3.3.7 compliance but is never used to SELECT the algorithm (Ed25519 is
// key-derived); `created` is a freshness timestamp in seconds.
export interface SignatureParamsInput {
  keyid: string;
  created: number;
  alg: string;
}

export interface ParsedSignatureInput {
  label: string;
  components: string[];
  keyid: string;
  created?: number;
  alg?: string;
  // The raw substring after the `sig1=` prefix, preserved verbatim so the
  // verifier can reconstruct the `@signature-params` signature-base line
  // byte-for-byte rather than re-serializing (which risks whitespace/ordering
  // drift, and stays compatible with a future peer's serialization).
  paramsValue: string;
}

// Standard base64 (with padding) over raw bytes — used for the Signature
// byte-sequence and Content-Digest.
function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// Returns an ArrayBuffer-backed view (not ArrayBufferLike) so the bytes satisfy
// BufferSource at the WebCrypto verify call site without a copy or cast.
function decodeBase64(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// Serialize the `@signature-params` value: an inner list of quoted component
// identifiers followed by the keyid/created/alg parameters. Signer and verifier
// share this exact serializer so the signed bytes are identical.
//   ("@method" "@authority" "@path" "content-digest" "date");keyid="...";created=<int>;alg="ed25519"
export function serializeSignatureParams(components: string[], p: SignatureParamsInput): string {
  const inner = components.map((c) => `"${c}"`).join(' ');
  return `(${inner});keyid="${p.keyid}";created=${p.created};alg="${p.alg}"`;
}

// Serialize the Signature header value: `sig1=:<base64 bytes>:`.
export function serializeSignatureValue(bytes: Uint8Array): string {
  return `${LABEL}=:${encodeBase64(bytes)}:`;
}

// Parse the Signature header value `sig1=:<base64>:` back to raw bytes. The
// anchored match also rejects a second member (multi-signature) out of scope.
// Re-encoding and requiring an exact match rejects non-canonical base64 (e.g.
// slack bits set in the final character) — without this, a 64-byte Ed25519
// signature has up to 16 distinct base64 spellings that all decode to the same
// bytes and verify, which would let the raw header value used as the replay
// nonce key be trivially varied to bypass the replay cache (see Finding C).
export function parseSignatureValue(value: string): Result<Uint8Array<ArrayBuffer>, string> {
  const match = value.trim().match(/^sig1=:([A-Za-z0-9+/=]*):$/);
  if (!match || match[1] === undefined) {
    return err('Malformed Signature header');
  }
  const bytes = decodeBase64(match[1]);
  if (!bytes || encodeBase64(bytes) !== match[1]) {
    return err('Invalid base64 byte sequence in Signature header');
  }
  return ok(bytes);
}

// RFC 9530 Content-Digest value from a body's base64 SHA-256 digest.
export function serializeContentDigest(bodySha256B64: string): string {
  return `sha-256=:${bodySha256B64}:`;
}

// Parse the inner list of quoted component identifiers, e.g.
// `"@method" "@authority" "content-digest"` → ['@method','@authority','content-digest'].
function parseInnerList(inner: string): Result<string[], string> {
  const trimmed = inner.trim();
  if (trimmed === '') return ok([]);
  const components: string[] = [];
  for (const part of trimmed.split(/\s+/)) {
    const match = part.match(/^"([^"]*)"$/);
    if (!match || match[1] === undefined) {
      return err(`Invalid component identifier: ${part}`);
    }
    components.push(match[1]);
  }
  return ok(components);
}

// Character-scanning parser for the `;name=value` parameters trailing the inner
// list. Values are quoted strings (keyid/alg) or bare integers (created). A
// top-level comma signals a second dictionary member — rejected as multi-signature.
function parseParams(input: string): Result<Record<string, string | number>, string> {
  const params: Record<string, string | number> = {};
  let i = 0;
  const skipWs = (): void => {
    while (i < input.length && (input[i] === ' ' || input[i] === '\t')) i++;
  };

  skipWs();
  while (i < input.length) {
    if (input[i] === ',') {
      return err('Multiple signatures are not supported');
    }
    if (input[i] !== ';') {
      return err(`Unexpected character in signature parameters: ${input[i]}`);
    }
    i++; // consume ';'
    skipWs();

    const nameStart = i;
    while (i < input.length && /[a-z0-9_.*-]/.test(input[i] as string)) i++;
    const name = input.slice(nameStart, i);
    if (name === '') return err('Empty parameter name');
    skipWs();

    if (input[i] !== '=') {
      return err(`Parameter ${name} is missing a value`);
    }
    i++; // consume '='
    skipWs();

    if (input[i] === '"') {
      i++; // consume opening quote
      const valueStart = i;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\') i++; // skip the escaped character
        i++;
      }
      if (i >= input.length) return err(`Unterminated quoted value for ${name}`);
      const raw = input.slice(valueStart, i);
      i++; // consume closing quote
      params[name] = raw.replace(/\\(.)/g, '$1');
    } else {
      const valueStart = i;
      while (i < input.length && /[0-9-]/.test(input[i] as string)) i++;
      const raw = input.slice(valueStart, i);
      if (!/^-?\d+$/.test(raw)) {
        return err(`Invalid integer value for ${name}`);
      }
      params[name] = Number(raw);
    }
    skipWs();
  }

  return ok(params);
}

// Parse a Signature-Input header value into its components and parameters.
// Enforces the single-`sig1`-member scope, extracts keyid (required) plus
// optional created/alg, and returns the raw `paramsValue` substring for
// byte-exact signature-base reconstruction.
export function parseSignatureInput(value: string): Result<ParsedSignatureInput, string> {
  const trimmed = value.trim();
  const eq = trimmed.indexOf('=');
  if (eq <= 0) {
    return err('Malformed Signature-Input header');
  }

  const label = trimmed.slice(0, eq).trim();
  if (label !== LABEL) {
    return err(`Only the ${LABEL} signature label is supported`);
  }

  // Everything after `sig1=` is preserved verbatim for signature-base reuse.
  const paramsValue = trimmed.slice(eq + 1);
  if (!paramsValue.startsWith('(')) {
    return err('Signature-Input is missing the covered-component list');
  }
  const close = paramsValue.indexOf(')');
  if (close === -1) {
    return err('Signature-Input covered-component list is not closed');
  }

  const componentsResult = parseInnerList(paramsValue.slice(1, close));
  if (!componentsResult.ok) return componentsResult;

  const paramsResult = parseParams(paramsValue.slice(close + 1));
  if (!paramsResult.ok) return paramsResult;

  const keyid = paramsResult.value.keyid;
  if (typeof keyid !== 'string') {
    return err('Signature-Input is missing the keyid parameter');
  }
  const created =
    typeof paramsResult.value.created === 'number' ? paramsResult.value.created : undefined;
  const alg = typeof paramsResult.value.alg === 'string' ? paramsResult.value.alg : undefined;

  return ok({ label, components: componentsResult.value, keyid, created, alg, paramsValue });
}
