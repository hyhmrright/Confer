import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Thrown when a hostname resolves to (or literally is) a private, loopback,
// link-local, or otherwise reserved address. Callers distinguish this from a
// plain DNS-resolution failure: a blocked address must abort the request, while
// a name that simply doesn't resolve is harmless (the subsequent fetch fails on
// its own with nothing to connect to).
export class SsrfBlockedError extends Error {
  readonly hostname: string;
  readonly address: string;

  constructor(hostname: string, address: string) {
    super(`Refusing to connect to ${hostname}: ${address} is a private or reserved address`);
    this.name = 'SsrfBlockedError';
    this.hostname = hostname;
    this.address = address;
  }
}

// Thrown when the resolver produced no answer at all before the deadline.
//
// Every call site has to decide about this one; it is a sibling of
// SsrfBlockedError, not a subclass, so a `catch` that handles only the block
// lets this one fall through to the fetch it was guarding — silently. All three
// callers therefore account for it in so many words, two by refusing it and
// routes/users.ts by admitting it on purpose.
//
// It is deliberately not folded into the harmless "name doesn't resolve" case,
// even though both leave us without an address. A definitive negative —
// NXDOMAIN, no records — is an answer, and it means the caller's own fetch
// fails the same way, so waving it through costs nothing. Silence is not an
// answer. The caller resolves the name a second time, independently, and that
// lookup is not bounded by us: an authoritative server that stalls past our
// deadline and then answers the fetch normally would have skipped this guard
// entirely, and the one party who can arrange that is whoever controls the name
// we were asked to dial. So where the name came from someone else, no answer
// means we could not verify, and could-not-verify refuses.
export class SsrfUnresolvedError extends Error {
  readonly hostname: string;

  constructor(hostname: string, timeoutMs: number) {
    super(`Refusing to connect to ${hostname}: no DNS answer within ${timeoutMs}ms`);
    this.name = 'SsrfUnresolvedError';
    this.hostname = hostname;
  }
}

// A healthy resolver answers in single-digit milliseconds; this is a ceiling on
// a hang, not a performance budget. It matters most on the inbound A2A path,
// where the hostname comes from the peer's own DID: before this bound existed a
// black-holed resolver held the request until Bun's 255s idle timeout.
const DNS_TIMEOUT_MS = 5_000;

// IPv4 ranges we refuse to connect to (SSRF surface): unspecified, private,
// loopback, link-local, carrier-grade NAT.
const BLOCKED_V4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
];

function ipv4ToInt(ip: string): number | null {
  const octets = ip.split('.');
  if (octets.length !== 4) return null;
  let value = 0;
  for (const octet of octets) {
    const n = Number(octet);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function inCidr(value: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (baseInt & mask) >>> 0;
}

function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // malformed → fail closed
  return BLOCKED_V4_CIDRS.some(([base, prefix]) => inCidr(value, base, prefix));
}

// Fixed-length tuple so downstream destructuring/indexing is `number`, not
// `number | undefined`, without re-checking a length we already verified.
type Hextets = readonly [number, number, number, number, number, number, number, number];

// Expand an IPv6 literal to its 8 canonical 16-bit hextets, resolving both
// the `::` compression and a trailing dotted-quad (e.g. `::ffff:1.2.3.4`).
// Returns null for anything we can't parse — callers must fail closed on
// null rather than assume "no embedded IPv4".
function expandIpv6(ip: string): Hextets | null {
  const dot = ip.lastIndexOf('.');
  let addr = ip;
  if (dot !== -1) {
    const lastColon = addr.lastIndexOf(':');
    if (lastColon === -1 || lastColon > dot) return null;
    const v4 = ipv4ToInt(addr.slice(lastColon + 1));
    if (v4 === null) return null;
    addr = `${addr.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [beforeCompression, afterCompression, ...rest] = addr.split('::');
  if (rest.length > 0) return null; // more than one `::` is invalid
  const parseHextets = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  if (afterCompression === undefined) {
    const groups = parseHextets(beforeCompression ?? '');
    return groups?.length === 8 ? (groups as unknown as Hextets) : null;
  }
  const head = parseHextets(beforeCompression ?? '');
  const tail = parseHextets(afterCompression);
  if (!head || !tail) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array(fill).fill(0), ...tail] as unknown as Hextets;
}

// Extract the embedded IPv4 address from an expanded IPv6 hextet array, if
// this address uses one of the standard IPv4-in-IPv6 encodings. Covers every
// form that could smuggle a private IPv4 target past a naive checker:
// IPv4-mapped (::ffff:a.b.c.d, dotted or all-hex), the deprecated
// IPv4-compatible form (::a.b.c.d), NAT64 (64:ff9b::/96), and 6to4
// (2002:a.b.c.d::/16).
function embeddedIpv4(groups: Hextets): string | null {
  const dotted = (hi: number, lo: number): string =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const [a, b, c, d, e, f, g, h] = groups;
  if (a === 0x2002) return dotted(b, c); // 6to4
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return dotted(g, h); // NAT64
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return dotted(g, h); // IPv4-mapped
    if (f === 0 && (g !== 0 || h > 1)) return dotted(g, h); // IPv4-compatible, excludes :: and ::1
  }
  return null;
}

// True when every hextet but the last is zero — the shape shared by both
// `::` (unspecified) and `::1` (loopback), however either was compressed.
function isZeroExceptLast(groups: Hextets): boolean {
  return groups.slice(0, 7).every((g) => g === 0);
}

function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  const groups = expandIpv6(addr);
  if (!groups) return true; // isIP already validated this as IPv6; fail closed if we still can't parse it

  const embedded = embeddedIpv4(groups);
  if (embedded) return isBlockedIpv4(embedded);
  if (isZeroExceptLast(groups) && groups[7] <= 1) return true; // :: / ::1
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique local
  return false;
}

// True when the given literal IP falls in a blocked range. Non-IP input fails
// closed (treated as blocked); callers only pass literal IPs or DNS-resolved
// addresses, so a non-IP here is an anomaly we refuse rather than trust.
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true;
}

// True for the loopback range (127.0.0.0/8, ::1, ::ffff:127.x). Callers that
// legitimately talk to their own host (e.g. DID resolution against a
// single-machine `did:web:localhost` deployment) opt loopback back in via
// `allowLoopback` without also re-admitting the LAN / metadata ranges.
function isLoopbackIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    return value !== null && inCidr(value, '127.0.0.0', 8);
  }
  const groups = expandIpv6(ip.toLowerCase());
  if (!groups) return false; // unparseable → not additionally allowed; isBlockedIpv6 already fails closed on it
  const embedded = embeddedIpv4(groups);
  if (embedded) {
    const value = ipv4ToInt(embedded);
    return value !== null && inCidr(value, '127.0.0.0', 8);
  }
  return isZeroExceptLast(groups) && groups[7] === 1; // ::1 only — :: (unspecified) is not loopback
}

/** `dnsTimeoutMs` bounds the lookup; past it the guard throws SsrfUnresolvedError. */
export interface SsrfGuardOptions {
  allowLoopback?: boolean;
  dnsTimeoutMs?: number;
}

// Resolve a hostname and reject it if it (or any of its addresses) points at a
// private/reserved range. Returns the resolved addresses on success. A literal
// IP is checked directly; otherwise DNS resolution decides. Throws
// SsrfBlockedError for a blocked target, SsrfUnresolvedError when the resolver
// never answered, and propagates the DNS error for a name that answered with a
// definitive negative. `allowLoopback` permits 127.0.0.0/8 and ::1 (still
// blocking every other private/reserved range) for callers whose own service
// lives on loopback.
export async function assertPublicHostname(
  hostname: string,
  opts?: SsrfGuardOptions,
): Promise<string[]> {
  const allowLoopback = opts?.allowLoopback ?? false;
  return assertAddresses(
    hostname,
    (address) => isBlockedIp(address) && !(allowLoopback && isLoopbackIp(address)),
    opts?.dnsTimeoutMs ?? DNS_TIMEOUT_MS,
  );
}

// True for the link-local ranges: IPv4 169.254.0.0/16 and IPv6 fe80::/10.
// 169.254.169.254 is the cloud instance-metadata address on AWS, GCP, Azure,
// OCI, DigitalOcean and Alibaba alike, and `fd00:ec2::254` its AWS IPv6 twin —
// the single highest-value SSRF target on any hosted deployment, since the
// metadata service authenticates callers by nothing but their ability to reach
// it. Nothing legitimate is ever addressed this way.
function isLinkLocalIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const value = ipv4ToInt(ip);
    return value !== null && inCidr(value, '169.254.0.0', 16);
  }
  const addr = ip.toLowerCase();
  const groups = expandIpv6(addr);
  if (!groups) return true; // unparseable but claims to be IPv6 → fail closed
  const embedded = embeddedIpv4(groups);
  if (embedded) {
    const value = ipv4ToInt(embedded);
    return value !== null && inCidr(value, '169.254.0.0', 16);
  }
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10
  return groups[0] === 0xfd00 && groups[1] === 0x0ec2; // fd00:ec2::/32 (AWS IMDS over IPv6)
}

/**
 * Reject a hostname that resolves to a link-local address, while leaving every
 * other private range reachable.
 *
 * This is the gate for addresses the owner deliberately points us at — a local
 * LLM runtime is the case that exists — where `assertPublicHostname` would be
 * wrong: `host.docker.internal`, `localhost` and a LAN address are the
 * documented ways to run Ollama, so blocking private ranges would block the
 * feature rather than an attack. What stays blocked is the one range with no
 * legitimate use, which is also the one worth reaching: cloud metadata.
 */
export function assertNotLinkLocalHostname(
  hostname: string,
  opts?: SsrfGuardOptions,
): Promise<string[]> {
  return assertAddresses(hostname, isLinkLocalIp, opts?.dnsTimeoutMs ?? DNS_TIMEOUT_MS);
}

// Resolve `hostname` to its addresses and throw SsrfBlockedError if `blocked`
// rejects any of them. Shared by the two asserts above so they cannot disagree
// about bracket notation or about which addresses a name actually has.
async function assertAddresses(
  hostname: string,
  blocked: (address: string) => boolean,
  dnsTimeoutMs: number,
): Promise<string[]> {
  const reject = (address: string): void => {
    if (blocked(address)) {
      throw new SsrfBlockedError(hostname, address);
    }
  };

  // `[::1]`-style bracket notation is a URL-serialization convention for an
  // IPv6 literal — `node:net`'s isIP() and `node:dns`'s lookup() both treat it
  // as an ordinary (unresolvable) name, not as the address it denotes. Left
  // unstripped, a bracketed private/loopback/metadata literal fails DNS
  // resolution, which this function's "resolution failure is not a block"
  // policy would then silently wave through — while a caller's subsequent
  // fetch() connects to the bracketed literal directly, since it needs no DNS
  // step at all. Stripping the brackets before the isIP/lookup checks routes
  // it through the same literal-IP rejection path as the unbracketed form.
  const hadBrackets = hostname.startsWith('[') && hostname.endsWith(']');
  const bareHost = hadBrackets ? hostname.slice(1, -1) : hostname;

  // Bracket notation is reserved for IP literals (RFC 3986 IP-literal), never
  // a DNS name. A bracketed value that isn't actually a valid IP (including
  // empty brackets, `[]`) is malformed input, not a hostname to resolve —
  // fail closed instead of falling through to DNS, where a lookup failure
  // would otherwise be silently treated as "not a block".
  if (hadBrackets && isIP(bareHost) === 0) {
    throw new SsrfBlockedError(hostname, bareHost);
  }

  if (isIP(bareHost) !== 0) {
    reject(bareHost);
    return [bareHost];
  }

  const resolved = await lookupWithin(bareHost, dnsTimeoutMs);
  const addresses = resolved.map((entry) => entry.address);
  for (const address of addresses) reject(address);
  return addresses;
}

// `dns.promises.lookup` takes no AbortSignal, so the deadline has to be a race.
// The losing lookup keeps its libuv threadpool slot until the OS resolver gives
// up, which is the cost of not having a cancel; it is bounded by the rate
// limiter in front of every caller, and the alternative — `dns.Resolver`, which
// does support a timeout — asks c-ares directly and so cannot see /etc/hosts,
// where `host.docker.internal` lives. Losing the local LLM runtime to fix a
// hang would be trading a whole feature for a deadline.
async function lookupWithin(hostname: string, ms: number): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, rejectRace) => {
        timer = setTimeout(() => rejectRace(new SsrfUnresolvedError(hostname, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
