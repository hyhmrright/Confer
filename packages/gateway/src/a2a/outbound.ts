import {
  assertPublicHostname,
  importPrivateKey,
  readCappedText,
  signRequest,
} from '@confer/identity';
import { err, ok, type Result } from '@confer/shared';
import { dialableEndpoint, selfA2AEndpoint } from '../lib/public-identity.js';

export interface OutboundA2AMessage {
  from: string;
  to: string;
  thread_id?: string;
  message: {
    type: 'question' | 'answer' | 'notification';
    content: string;
    language?: string;
    // Machine-readable detail alongside the prose. A failure notice puts its
    // code here so the receiving side can act on it without parsing English.
    context?: Record<string, unknown>;
  };
}

export interface OutboundResult {
  message_id: string;
  thread_id: string;
  stream_url: string;
}

// A reply is three ids. The far side decides how much it sends, so the read
// stops long before that could matter to a single-process gateway.
const MAX_RESPONSE_BYTES = 64 * 1024;

export async function sendA2AMessage(
  endpoint: string,
  message: OutboundA2AMessage,
  signerKeyId: string,
  privateKeyJwk: string,
): Promise<Result<OutboundResult, string>> {
  try {
    const body = JSON.stringify(message);
    const target = `${endpoint}/messages`;
    // Only our exact advertised endpoint is rewritten to loopback; anything else
    // is a peer's address and is vetted. Deciding by what the rewrite did let a
    // peer publish `<ours>/../../api/…`: the string starts the way ours does, so
    // it was rewritten and skipped every check, and the URL it parses to is an
    // arbitrary path of this process.
    const isSelf = endpoint === selfA2AEndpoint();
    if (!isSelf) {
      const refused = await refusePeerUrl(target);
      if (refused) return err(refused);
    }
    // Resolved before signing, not after: the signature covers `@authority`,
    // and the verifier rebuilds that from the request it actually received. A
    // rewrite applied afterwards would sign one authority and deliver another.
    const url = isSelf ? dialableEndpoint(target) : target;

    const baseRequest = new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
    });

    const privateKey = await importPrivateKey(JSON.parse(privateKeyJwk) as JsonWebKey);
    const signedRequest = await signRequest(baseRequest, privateKey, signerKeyId);

    // `manual`: the address was vetted, not wherever it redirects to.
    const response = await fetch(signedRequest, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return err(`Remote returned ${response.status}${await remoteErrorCode(response)}`);
    }

    const text = await readCappedText(response, MAX_RESPONSE_BYTES);
    try {
      return ok(JSON.parse(text) as OutboundResult);
    } catch {
      // Not the parser's message: it quotes the body it choked on.
      return err('Remote returned a response that is not JSON');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`sendA2AMessage failed: ${message}`);
  }
}

/**
 * Why a peer's advertised endpoint must not be dialled, or null if it may be.
 *
 * The address comes from a DID document its owner wrote, where
 * `serviceEndpoint` is checked for being a string and nothing more — so a
 * consult used to POST, signed, to whatever that document named:
 * `http://qdrant:6333/…`, the metadata service, the Docker host. Federation is
 * https to a public name by construction (did:web resolution is https-only), so
 * that is all this admits. A query or fragment is refused too, because a
 * trailing `?` in the published endpoint swallowed the `/messages` appended
 * above and let the document choose the whole path.
 */
async function refusePeerUrl(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Peer endpoint is not a valid URL';
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    return 'Peer endpoint must be a plain https URL';
  }
  try {
    await assertPublicHostname(url.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return 'Peer endpoint does not resolve to a public address';
  }
  return null;
}

/**
 * The peer's error code, when it sent one in our `{error: {code}}` shape —
 * never its body. This message reaches the consult route's 502, and a body is
 * whatever the far side chose to put there, which for an address that slipped
 * past the check above would be an internal service's own response.
 */
async function remoteErrorCode(response: Response): Promise<string> {
  try {
    const body = JSON.parse(await readCappedText(response, MAX_RESPONSE_BYTES)) as {
      error?: { code?: unknown };
    };
    const code = body.error?.code;
    return typeof code === 'string' && /^[a-z0-9_]{1,64}$/.test(code) ? ` (${code})` : '';
  } catch {
    return '';
  }
}
