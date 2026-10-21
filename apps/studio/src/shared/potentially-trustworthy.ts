/**
 * Chromium's localhost test (`net::IsLocalhost`): `localhost` and any name
 * under `.localhost`, either with a trailing dot, 127.0.0.0/8, and ::1. Reads
 * the host as the URL parser canonicalized it, so `127.1` is already
 * `127.0.0.1` and `[0::1]` is `[::1]`.
 */
export function isLocalhost(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]"
  );
}

/**
 * Chromium's "potentially trustworthy" test for an address
 * (`net::IsUrlPotentiallyTrustworthy`), the one that decides whether its
 * address field and its sign-in dialog warn: an encrypted scheme, a page on
 * localhost, or a file.
 */
export function isPotentiallyTrustworthy(address: string): boolean {
  const url = URL.parse(address);
  if (!url) {
    return false;
  }
  return (
    url.protocol === "https:" ||
    url.protocol === "wss:" ||
    url.protocol === "file:" ||
    isLocalhost(url)
  );
}
