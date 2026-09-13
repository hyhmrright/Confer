import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import type { Fetcher } from '@confer/agent-runtime';
import { assertNotMetadataHostname } from '@confer/identity';

/**
 * Whether `value` can stand as a local runtime's base URL: http(s), with no
 * credentials, query or fragment.
 *
 * A local runtime (a `keyIsBaseUrl` catalogue entry) stores its address in the
 * slot a hosted vendor uses for a key, and every dialer appends its own path to
 * it — `/v1/embeddings`, the models path, the completions path. A `?` or `#` in
 * the stored value turned that suffix into a query string or a fragment and let
 * the owner choose the whole path: `http://qdrant:6333/collections/x/snapshots?`
 * was a snapshot POSTed to the gateway's own vector store. The raw string is
 * tested rather than the parsed URL, because a bare trailing `?` parses to an
 * empty query and still swallows the suffix.
 */
export function isRuntimeBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !/[?#]/.test(value)
    );
  } catch {
    return false;
  }
}

/**
 * A fetch for a local runtime, connected to the addresses its base URL resolved
 * to when this checked it.
 *
 * The check refuses a base that is not a plain http(s) base URL, or whose name
 * resolves to cloud metadata (see assertNotMetadataHostname). Private addresses
 * stay reachable on purpose — they are where a local runtime lives — and what
 * keeps that from being a POST to anywhere is that the path is ours and no
 * dialer hands the far side's response body back to the caller.
 *
 * Checking the name and then handing the URL to `fetch` resolved it twice, and
 * whoever runs that name's DNS chose the second answer: a LAN address for the
 * check, 169.254.169.254 for the connection. Every request made through the
 * returned function connects to an address the check saw instead. That takes
 * node:http, because Bun's fetch accepts no resolver and overwrites a Host
 * header, so pinning it would mean dialling the IP literal and losing the name
 * that virtual hosting and TLS both need.
 *
 * node:http also ignores HTTP(S)_PROXY, which fetch honoured, and that stays so.
 * A proxy resolves the name again itself — the second answer this closes — and
 * loopback or the Docker host, where a local runtime usually lives, would be
 * the proxy's own machine once the proxy dialled them.
 *
 * Build one per use rather than per stored address. The settings route checks
 * an address when it is saved, but a name can be re-pointed afterwards, and a
 * value saved before these rules existed was never looked at again.
 */
export async function runtimeFetcher(base: string): Promise<Fetcher> {
  if (!isRuntimeBaseUrl(base)) {
    throw new Error('Local runtime address must be a plain http(s) base URL');
  }
  const addresses = await assertNotMetadataHostname(new URL(base).hostname.replace(/^\[|\]$/g, ''));
  const vetted = addresses.map((address) => ({ address, family: isIP(address) }));
  const [first] = vetted;
  if (!first) throw new Error('Local runtime address did not resolve');

  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, vetted);
    else callback(null, first.address, first.family);
  };
  return (url, init = {}) => pinnedRequest(url, init, lookup);
}

// Statuses a Response has to be built without a body for.
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function pinnedRequest(
  url: string,
  init: NonNullable<Parameters<Fetcher>[1]>,
  lookup: LookupFunction,
): Promise<Response> {
  const target = new URL(url);
  const send = (target.protocol === 'https:' ? https.request : http.request) as typeof http.request;
  return new Promise((resolve, reject) => {
    const request = send(
      target,
      // `agent: false`: a pooled socket is keyed by host and port, not by the
      // address it reached, so reuse could hand this request a connection that
      // no check here ever saw.
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        signal: init.signal,
        lookup,
        agent: false,
      },
      (res) => {
        // A throw from this callback would be an uncaught exception in the
        // gateway process rather than a failed call, and a status fetch would
        // never produce (anything outside 200–599) makes Response throw.
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            for (const item of [value ?? []].flat()) headers.append(name, item);
          }
          const status = res.statusCode ?? 0;
          const body = NULL_BODY_STATUSES.has(status)
            ? null
            : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
          resolve(new Response(body, { status, headers }));
        } catch (e) {
          res.destroy();
          reject(e);
        }
      },
    );
    // node:http names the address it could not reach (`connect ECONNREFUSED
    // 172.17.0.1:11434`) where fetch said only that it could not connect, and
    // the message travels on into tool results a peer's turn can repeat. The
    // name survives, because the retry classifier reads AbortError from it.
    request.on('error', (e) => {
      console.error('Local runtime request failed:', e.message);
      reject(Object.assign(new Error('Could not reach the local runtime'), { name: e.name }));
    });
    request.end(init.body);
  });
}
