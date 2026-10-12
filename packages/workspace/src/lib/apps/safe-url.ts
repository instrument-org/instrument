import { isLoopbackHost } from "./manifest";

/**
 * The per-hop check for both app types: `api` requests and `mcp` connections
 * run it alike, so a manifest cannot pick the weaker of the two.
 *
 * Any address is allowed, a self-hosted service on the local network
 * included, the way `curl` and `web_fetch` allow it. A non-loopback hop must
 * be https, since an app request carries the user's credential.
 *
 * Returns an error message to surface, or null when the URL is allowed.
 */
export async function checkAppUrl(url: URL): Promise<null | string> {
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    return `App requests must use https (got "${url.protocol}//").`;
  }
  return null;
}
