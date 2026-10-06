/**
 * What a page's address says about its connection, in the terms a browser's
 * address field speaks them: nothing for an encrypted page or one that never
 * crossed the network, and a warning for plain http.
 *
 * Plain http to this machine is its own case, the way Chromium treats it: a
 * loopback address is "potentially trustworthy" (nothing leaves the
 * computer), so it earns no warning, but the connection is still not
 * encrypted and the page's details say so.
 */
export type PageConnection = "insecure" | "local" | "secure";

export function pageConnection(url: string): PageConnection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "secure";
  }
  if (parsed.protocol !== "http:") {
    return "secure";
  }
  return isLoopback(parsed.hostname) ? "local" : "insecure";
}

/** Chromium's loopback names: `localhost` and its subdomains, 127.0.0.0/8, and ::1. */
function isLoopback(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127(?:\.\d{1,3}){3}$/.test(host) ||
    host === "[::1]"
  );
}
