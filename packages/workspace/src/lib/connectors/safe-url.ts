import dns from "node:dns/promises";
import net from "node:net";

import { isLoopbackHost } from "./manifest";

const PRIVATE_V4_PATTERNS = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

/**
 * Refuse a URL that could reach non-public address space, for both connector
 * types: `api` requests and `mcp` connections run the same check so a manifest
 * cannot pick the weaker of the two.
 *
 * The agent writes the manifest, so it chooses the hostname: a name-only check
 * is not enough, because a public-looking host can resolve to a private or
 * link-local address (a name that encodes `127.0.0.1`, a CNAME to the cloud
 * metadata endpoint). So the name is checked first, then every address it
 * resolves to.
 *
 * This is a resolve-then-connect check, so it narrows the hole rather than
 * closing it: a name that answers differently on the second lookup still
 * rebinds. Closing that needs the socket pinned to the address that was
 * checked, which neither `fetch` nor the MCP transport exposes. Loopback stays
 * allowed only when the connector's configured base is itself loopback (local
 * services, tests).
 *
 * Returns an error message to surface, or null when the URL is allowed.
 */
export async function checkPublicUrl(
  url: URL,
  { allowLoopback }: { allowLoopback: boolean },
): Promise<null | string> {
  const hostname = url.hostname.toLowerCase();

  if (isLoopbackHost(hostname)) {
    return allowLoopback
      ? null
      : `Refusing to reach loopback address "${hostname}" for a non-loopback connector.`;
  }

  if (url.protocol !== "https:") {
    return `Connector requests must use https (got "${url.protocol}//").`;
  }

  if (
    PRIVATE_V4_PATTERNS.some((pattern) => pattern.test(hostname)) ||
    hostname.startsWith("[") ||
    hostname.includes(":")
  ) {
    return privateAddressMessage(hostname);
  }

  // A bare IP literal that got past the patterns above has nothing to resolve.
  if (net.isIP(hostname) !== 0) {
    return isPrivateAddress(hostname) ? privateAddressMessage(hostname) : null;
  }

  let addresses: string[];
  try {
    // `lookup` rather than `resolve`, so the answer comes from the same resolver
    // path the request will use, including /etc/hosts.
    const entries = await dns.lookup(hostname, { all: true });
    addresses = entries.map((entry) => entry.address);
  } catch (error) {
    return `Could not resolve "${hostname}": ${error instanceof Error ? error.message : String(error)}`;
  }

  // Every answer has to be public: one private address in a multi-answer set is
  // enough for the connection to land there.
  const privateAddress = addresses.find((address) => isPrivateAddress(address));
  return privateAddress === undefined
    ? null
    : privateAddressMessage(`${hostname} (resolves to ${privateAddress})`);
}

/**
 * True for any address a request must not reach: loopback, the RFC1918 and
 * carrier-grade ranges, and link-local (which is where the cloud metadata
 * endpoint lives). Applied to resolved addresses, so unlike the hostname check
 * it has to cover IPv6 -- including the v4-mapped form, which is how a v6
 * resolver hands back `127.0.0.1`.
 */
function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replaceAll(/^\[|\]$/g, "");

  if (net.isIPv4(value)) {
    return (
      value.startsWith("127.") ||
      PRIVATE_V4_PATTERNS.some((pattern) => pattern.test(value))
    );
  }

  if (!net.isIPv6(value)) {
    // Not an address at all; the caller only passes resolver output, so this is
    // unreachable in practice and fails closed rather than waving it through.
    return true;
  }

  // ::ffff:127.0.0.1 and friends: classify by the embedded v4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped?.[1]) {
    return isPrivateAddress(mapped[1]);
  }

  return (
    value === "::" ||
    value === "::1" ||
    // fc00::/7 unique-local, fe80::/10 link-local.
    /^f[cd]/.test(value) ||
    /^fe[89ab]/.test(value)
  );
}

function privateAddressMessage(description: string): string {
  return `Refusing to reach private or non-public address "${description}".`;
}
