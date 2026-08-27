// Pure derivations from a PUBLIC_HOST string. Kept free of any import so that
// env.ts can validate the value with the same parser the rest of the app then
// derives identities from — importing public-identity.ts there would close a
// cycle, since that module reads env itself.

// Hosts that only ever exist on the machine running the gateway, where TLS is
// not in play. Everything else is assumed to be served over https, which is
// also what did:web implies.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// PUBLIC_HOST is written by hand, so accept the shapes an operator is likely to
// paste (`https://example.com/`) and split them into hostname and port. Parsing
// through `URL` rather than splitting on `:` is what keeps an IPv6 literal
// intact — `[::1]:3000` has colons on both sides of the one that matters.
// Throws on input `URL` cannot parse; env.ts rejects that at startup.
export function parsePublicHost(publicHost: string): { hostname: string; port: string } {
  const bare = publicHost
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const url = new URL(`http://${bare}`);
  return { hostname: url.hostname, port: url.port };
}

// `did:web` splits its method-specific id on `:`, so a port has to be
// percent-encoded or the resolver reads it as a path segment instead —
// `parseDidWeb` decodes it back on the way in. `localhost:3000` becomes
// `localhost%3A3000`.
export function toDidAuthority(publicHost: string): string {
  const { hostname, port } = parsePublicHost(publicHost);
  return port ? `${hostname}%3A${port}` : hostname;
}

// The origin peers should actually dial. http for a loopback host because a
// single-machine install has no certificate; https for everything else.
export function toSelfOrigin(publicHost: string): string {
  const { hostname, port } = parsePublicHost(publicHost);
  const scheme = LOOPBACK_HOSTS.has(hostname) ? 'http' : 'https';
  return `${scheme}://${hostname}${port ? `:${port}` : ''}`;
}
