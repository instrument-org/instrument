import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// cspell:ignore CGNAT
// Loopback, "this host", RFC1918 private, CGNAT, and link-local (which includes
// the cloud metadata endpoint 169.254.169.254), plus the IPv6 equivalents.
// Mirrors the just-bash sandbox's `denyPrivateRanges` posture so `web_fetch`,
// which runs unsandboxed in the main process, cannot reach hosts bash cannot.
const PRIVATE_RANGES = new BlockList();
PRIVATE_RANGES.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_RANGES.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_RANGES.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_RANGES.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_RANGES.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_RANGES.addAddress("::", "ipv6");
PRIVATE_RANGES.addAddress("::1", "ipv6");
PRIVATE_RANGES.addSubnet("fc00::", 7, "ipv6");
PRIVATE_RANGES.addSubnet("fe80::", 10, "ipv6");

export function isPrivateAddress(address: string): boolean {
  // Normalize an IPv4-mapped IPv6 literal (e.g. `::ffff:169.254.169.254`) to its
  // v4 form so it can't slip past the v4 ranges.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const candidate = mapped?.[1] ?? address;
  const family = isIP(candidate);
  if (family === 4) {
    return PRIVATE_RANGES.check(candidate, "ipv4");
  }
  if (family === 6) {
    return PRIVATE_RANGES.check(candidate, "ipv6");
  }
  return false;
}

/**
 * Resolves `hostname` and reports whether it points at a private, loopback, or
 * link-local address. An unresolvable host is not an SSRF vector (the fetch will
 * fail on its own), so it is treated as public.
 *
 * Note: this validates at check time; a hostname that re-resolves to a private
 * address between this check and the actual connection (DNS rebinding) is not
 * defended against here.
 */
export async function isPrivateHostname(hostname: string): Promise<boolean> {
  const host = hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(host)) {
    return isPrivateAddress(host);
  }
  try {
    const resolved = await lookup(host, { all: true });
    return resolved.some((entry) => isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}
