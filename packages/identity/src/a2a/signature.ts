import { type Result, err, ok } from '@confer/shared';

export interface SignatureParams {
  keyId: string;
  algorithm: string;
  headers: string[];
  signature: string;
  created?: number;
}

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function parseSignatureHeader(header: string): Result<SignatureParams, string> {
  const params: Partial<SignatureParams> = {};

  const regex = /(\w+)="([^"]+)"/g;
  let match: RegExpExecArray | null = regex.exec(header);
  while (match !== null) {
    const [, key, value] = match;
    // Both capture groups are required by the regex, so a non-null match always
    // yields defined key/value; this guard makes that invariant explicit.
    if (key !== undefined && value !== undefined) {
      switch (key) {
        case 'keyId':
          params.keyId = value;
          break;
        case 'algorithm':
          params.algorithm = value;
          break;
        case 'headers':
          params.headers = value.split(' ');
          break;
        case 'signature':
          params.signature = value;
          break;
      }
    }
    match = regex.exec(header);
  }

  // `created` is an unquoted integer (RFC 9421 / cavage), so the quoted-value
  // loop above never captures it. Pull it out separately; absence is fine.
  const createdMatch = header.match(/(?:^|,)\s*created=(\d+)/);
  if (createdMatch?.[1]) {
    params.created = Number(createdMatch[1]);
  }

  if (!params.keyId || !params.signature || !params.headers) {
    return err('Incomplete signature header');
  }

  return ok(params as SignatureParams);
}

export async function buildSignatureString(
  request: Request,
  headers: string[],
  created?: number,
): Promise<string> {
  const url = new URL(request.url);
  const lines: string[] = [];

  for (const h of headers) {
    if (h === '(request-target)') {
      lines.push(`(request-target): ${request.method.toLowerCase()} ${url.pathname}`);
    } else if (h === '(created)') {
      // Prefer the signer's own timestamp so the verifier reproduces the exact
      // string the signature covers; fall back to now only when none is given.
      lines.push(`(created): ${created ?? Math.floor(Date.now() / 1000)}`);
    } else {
      const value = request.headers.get(h);
      if (value !== null) {
        lines.push(`${h.toLowerCase()}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}

export async function computeDigest(body: string): Promise<string> {
  const encoded = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(hash)))}`;
}

export async function verifyRequestSignature(
  request: Request,
  publicKey: CryptoKey,
): Promise<Result<true, string>> {
  const sigHeader = request.headers.get('signature');
  if (!sigHeader) {
    return err('Missing Signature header');
  }

  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed.ok) {
    return parsed;
  }

  // Finding B: a signature is only meaningful if it covers the request's
  // identity-bearing components. Without a mandated minimum an attacker can sign
  // a trivial set (e.g. just `date`), then swap the method/path/body after
  // signing and still verify. Require the minimum covered set, and — when the
  // request carries a body — require `digest` too, so the body is bound to the
  // signature rather than left free to tamper with.
  const covered = parsed.value.headers;
  for (const required of ['(request-target)', 'host', 'date']) {
    if (!covered.includes(required)) {
      return err(`Signature must cover ${required}`);
    }
  }
  const body = await request.clone().text();
  if (body.length > 0 && !covered.includes('digest')) {
    return err('Signature must cover digest for a request with a body');
  }

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

  // When `(created)` is part of the signed set, validate the signer's timestamp
  // against the same skew window (replay protection) and feed it back into the
  // signing string so we reproduce exactly what the signer covered rather than
  // stamping our own "now".
  if (parsed.value.headers.includes('(created)')) {
    const created = parsed.value.created;
    if (typeof created !== 'number') {
      return err('Signature references (created) but no created parameter');
    }
    if (Math.abs(Date.now() - created * 1000) > MAX_CLOCK_SKEW_MS) {
      return err('Signature (created) outside acceptable window');
    }
  }

  if (parsed.value.headers.includes('digest')) {
    const digestHeader = request.headers.get('digest');
    if (!digestHeader) {
      return err('Digest header referenced but missing');
    }
    const expected = await computeDigest(body);
    if (digestHeader !== expected) {
      return err('Digest mismatch');
    }
  }

  const sigString = await buildSignatureString(request, parsed.value.headers, parsed.value.created);
  const sigBytes = Uint8Array.from(atob(parsed.value.signature), (c) => c.charCodeAt(0));
  const sigData = new TextEncoder().encode(sigString);

  const valid = await crypto.subtle.verify('Ed25519', publicKey, sigBytes, sigData);

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
  const url = new URL(request.url);

  const newHeaders = new Headers(request.headers);
  if (!newHeaders.has('date')) {
    newHeaders.set('date', new Date().toUTCString());
  }
  if (!newHeaders.has('host')) {
    newHeaders.set('host', url.host);
  }

  // Digest covers the request body, so only sign it when there is one. A
  // body-less GET that declared `digest` in its signing set would be rejected
  // at verification, since the verifier then demands a Digest header.
  const headers = ['(request-target)', 'host', 'date'];
  const body = await request.clone().text();
  if (body) {
    newHeaders.set('digest', await computeDigest(body));
    headers.push('digest');
  }

  const signed = new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: body || undefined,
  });

  const sigString = await buildSignatureString(signed, headers);
  const sigData = new TextEncoder().encode(sigString);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, sigData);
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  const sigHeaderValue = `keyId="${keyId}",algorithm="ed25519",headers="${headers.join(' ')}",signature="${sigBase64}"`;

  signed.headers.set('signature', sigHeaderValue);

  return signed;
}
