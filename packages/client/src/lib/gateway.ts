// Where the API is.
//
// The web build never needs this: nginx serves the app and proxies `/api` and
// `/ws` on the same origin, so every relative URL in the client resolves to the
// right place. A bundled desktop or mobile app has no such server — it serves
// its own assets from `tauri://localhost` (macOS, iOS) or `http://tauri.localhost`
// (Windows, Linux, Android), where `/api/v1` resolves to the bundle itself and
// every request comes back as the app's own index.html. It has to be told which
// instance it belongs to, and that is a runtime answer: a self-hosted address is
// known only to whoever deployed it.
//
// Everything unset falls back to relative URLs, which is exactly what the web
// build did before this file existed.

const STORAGE_KEY = 'confer_gateway';

type Origin = Pick<Location, 'protocol' | 'hostname'>;

/**
 * True when the page cannot reach a gateway through relative URLs, so one has to
 * be configured before anything works.
 *
 * Stated in terms of the origin serving the page rather than "is this Tauri",
 * because that is the thing that actually breaks. `tauri dev` loads the frontend
 * from the Vite dev server, whose proxy forwards `/api` and `/ws` just like
 * nginx — it is only the bundle that is on its own.
 */
export function gatewayUrlRequired(loc: Origin = location): boolean {
  return loc.protocol === 'tauri:' || loc.hostname === 'tauri.localhost';
}

// Empty means unset, which is the web build: every URL stays relative.
let gatewayUrl = localStorage.getItem(STORAGE_KEY) ?? '';

/** Prefix for every request, and the empty string when nothing is configured. */
export function gatewayOrigin(): string {
  return gatewayUrl;
}

export function setGatewayUrl(origin: string): void {
  gatewayUrl = origin;
  if (origin) localStorage.setItem(STORAGE_KEY, origin);
  else localStorage.removeItem(STORAGE_KEY);
}

export function apiBase(): string {
  return `${gatewayUrl}/api/v1`;
}

/**
 * Absolute WebSocket URL for a path, with the scheme following the gateway's own
 * — `wss:` for an https instance, `ws:` for http. Falls back to the page's origin,
 * which is what the web build has always used.
 */
export function websocketUrl(path: string): string {
  return `${(gatewayUrl || location.origin).replace(/^http/, 'ws')}${path}`;
}

/**
 * Reduce what someone would actually type to an origin, or null if it is not an
 * http(s) address.
 *
 * Returning null rather than storing the value is the point: an unusable address
 * saved here surfaces later as a bare network error on the login button, with
 * nothing on screen connecting it to the field that caused it.
 */
export function normalizeGatewayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  try {
    // A bare hostname is the common case — it is what `npx confer-cli --domain`
    // takes and what the deployment docs print. HTTPS is the right guess for it,
    // because did:web resolution is https-only and any instance meant to
    // federate is already there. Loopback is the exception and worth spending a
    // branch on: it is what the quick start produces, nobody puts a certificate
    // on it, and guessing https there sends the most likely first attempt into
    // a connection error with nothing on screen explaining the scheme.
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!hasScheme && isLoopback(url.hostname)) url.protocol = 'http:';
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
