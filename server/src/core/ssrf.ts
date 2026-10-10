/**
 * Server-side request forgery (SSRF) protection for configurable destinations.
 * - Only http/https; https required when policy.requireHttps is true (production).
 * - Blocks loopback, private, link-local, CGNAT, multicast, reserved and cloud metadata addresses
 *   unless policy.allowPrivateNetworks is explicitly enabled for a controlled internal deployment.
 * - Destination ports can be restricted.
 * - DNS answers are validated at connect time (see httpClient.ts), which also defeats DNS rebinding
 *   because the validated address is the one the socket connects to.
 */
import net from 'node:net';

export interface SsrfPolicy {
  allowPrivateNetworks: boolean;
  requireHttps: boolean;
  /** null = any port. */
  allowedPorts: number[] | null;
  /** Optional hostname allowlist (exact match or leading "*." wildcard). Empty/undefined = no allowlist. */
  allowedHosts?: string[];
}

export class SsrfError extends Error {
  code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
  }
}

const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([a, p]) => blocked.addSubnet(a as string, p as number, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001:db8::', 32], ['2001::', 32], ['2002::', 16],
].forEach(([a, p]) => blocked.addSubnet(a as string, p as number, 'ipv6'));

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /^metadata\.google\.internal$/i, /^metadata$/i, /\.internal$/i, /^instance-data$/i];

function embeddedIpv4(ip: string): string | null {
  // IPv4-mapped (::ffff:a.b.c.d) or compatible forms.
  const m = ip.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/i) || ip.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return m[1];
  const hex = ip.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16), lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True when an IP address is not publicly routable (or is a metadata address). */
export function isBlockedAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0];
  const fam = net.isIP(clean);
  if (fam === 4) return blocked.check(clean, 'ipv4');
  if (fam === 6) {
    const v4 = embeddedIpv4(clean);
    if (v4) return true; // IPv4-mapped/compatible IPv6 is never needed for public APIs; block to prevent bypasses
    return blocked.check(clean, 'ipv6');
  }
  return true; // not an IP: treat as blocked for safety
}

function hostAllowed(host: string, list?: string[]): boolean {
  if (!list || list.length === 0) return true;
  const h = host.toLowerCase();
  return list.some((entry) => {
    const e = entry.toLowerCase().trim();
    if (e.startsWith('*.')) return h.endsWith(e.slice(1)) && h.length > e.length - 1;
    return h === e;
  });
}

/** Static URL validation (protocol, credentials, port, hostname, literal IP). */
export function validateDestinationUrl(raw: string, policy: SsrfPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Destination URL is not a valid absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SsrfError(`Protocol "${url.protocol}" is not allowed`);
  if (policy.requireHttps && url.protocol !== 'https:') throw new SsrfError('HTTPS is required for destination URLs in this environment');
  if (url.username || url.password) throw new SsrfError('Credentials must not be embedded in URLs; use the connection credential store');
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (policy.allowedPorts && !policy.allowedPorts.includes(port)) throw new SsrfError(`Destination port ${port} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostAllowed(host, policy.allowedHosts)) throw new SsrfError(`Host "${host}" is not in the destination allowlist`);
  if (!policy.allowPrivateNetworks) {
    if (BLOCKED_HOSTNAMES.some((r) => r.test(host))) throw new SsrfError(`Host "${host}" is not allowed`);
    if (net.isIP(host) && isBlockedAddress(host)) throw new SsrfError(`Address ${host} is private, loopback, link-local or reserved`);
    // Decimal / octal / hex encoded IPv4 tricks (e.g. 2130706433, 0x7f.1) are normalised by WHATWG URL,
    // but reject any remaining purely numeric hostnames defensively.
    if (/^[0-9.]+$/.test(host) && !net.isIP(host)) throw new SsrfError(`Host "${host}" is not allowed`);
  }
  return url;
}

/** Validates DNS answers for a hostname. Throws if any resolved address is blocked. */
export function assertResolvedAddressesAllowed(host: string, addresses: string[], policy: SsrfPolicy): void {
  if (policy.allowPrivateNetworks) return;
  if (addresses.length === 0) throw new SsrfError(`Host "${host}" did not resolve to any address`);
  const bad = addresses.find((a) => isBlockedAddress(a));
  if (bad) throw new SsrfError(`Host "${host}" resolves to a blocked address (${bad})`);
}

/** Joins a base URL and an endpoint path without allowing the path to change the origin. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) throw new SsrfError('Endpoint path must be relative to the connection base URL');
  if (/(^|\/)\.\.(\/|$)/.test(path)) throw new SsrfError('Endpoint path must not contain ".." segments');
  const basePath = base.pathname.replace(/\/+$/, '');
  const [p, q] = path.split('?');
  const rel = p.startsWith('/') ? p : `/${p}`;
  const joined = new URL(base.origin);
  joined.pathname = `${basePath}${rel}`;
  if (q) joined.search = `?${q}`;
  if (joined.origin !== base.origin) throw new SsrfError('Endpoint path changed the destination origin');
  return joined.toString();
}
