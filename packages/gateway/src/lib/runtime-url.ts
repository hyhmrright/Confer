import { assertNotLinkLocalHostname } from '@confer/identity';

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
 * Refuse to dial a local runtime's address unless, at the moment of the dial,
 * it is still a base URL and does not resolve into the link-local range.
 *
 * The settings route checks the address when it is saved, and that had been
 * the only check: a name that did not resolve then was stored anyway, free to
 * be pointed at 169.254.169.254 afterwards, and nothing saved before the rule
 * above existed was ever looked at again. Any failure refuses — at dial time a
 * name that does not resolve has nothing to connect to regardless.
 *
 * Private addresses stay reachable on purpose (see assertNotLinkLocalHostname):
 * they are where a local runtime lives. What keeps that from being a POST to
 * anywhere is that the path is ours and no dialer hands the far side's response
 * body back to the caller.
 */
export async function assertDialableRuntimeUrl(value: string): Promise<void> {
  if (!isRuntimeBaseUrl(value)) {
    throw new Error('Local runtime address must be a plain http(s) base URL');
  }
  await assertNotLinkLocalHostname(new URL(value).hostname.replace(/^\[|\]$/g, ''));
}
