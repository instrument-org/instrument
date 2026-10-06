import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { getWorkspaceServerPort } from "../logic/server/url";

// Every address a connection to the workspace server's `127.0.0.1` socket can
// arrive through: the IPv4 loopback range, `0.0.0.0/8`, which a connect
// treats as this host, and the IPv6 loopback and unspecified addresses for a
// stack that hands those to the v4 socket.
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("0.0.0.0", 8, "ipv4");
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::", "ipv6");
LOOPBACK.addAddress("::1", "ipv6");

/**
 * Whether `url` reaches Instrument's own workspace server: a loopback host on
 * the port that server bound. Its routes (the CDP bridge, the model proxy)
 * were never audited for a caller the agent controls, so `curl`, `web_fetch`
 * and app requests refuse it while every other local and private address is
 * open to them.
 *
 * A hostname counts when any address it resolves to is loopback, so a public
 * name pointing at `127.0.0.1` is caught too. This is resolve-then-connect, so
 * a name that answers differently on the second lookup still gets through;
 * `node` and `python-native` reach the port regardless, so this steers the
 * tools the agent reaches for first rather than drawing a boundary.
 */
export async function isWorkspaceServerUrl(url: URL): Promise<boolean> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const port =
    url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  if (port !== getWorkspaceServerPort()) {
    return false;
  }
  const host = url.hostname.replaceAll(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    return isLoopbackAddress(host);
  }
  try {
    const resolved = await dns.lookup(host, { all: true });
    return resolved.some((entry) => isLoopbackAddress(entry.address));
  } catch {
    // An unresolvable host reaches nothing; the request fails on its own.
    return false;
  }
}

export function workspaceServerRefusal(url: URL): string {
  return `${url.host} is Instrument's own workspace server, which the agent's tools do not call`;
}

// `BlockList` checks an IPv4-mapped IPv6 address (`::ffff:7f00:1`, which is
// how `URL` spells `::ffff:127.0.0.1`) against the v4 rules.
function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? LOOPBACK.check(address, "ipv4")
    : family === 6 && LOOPBACK.check(address, "ipv6");
}
