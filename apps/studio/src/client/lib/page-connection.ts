import { isLocalhost } from "@/shared/potentially-trustworthy";

/**
 * What a page's address says about its connection, in the terms a browser's
 * address field speaks them: nothing for an encrypted page or one that never
 * crossed the network, and a warning for plain http.
 *
 * Plain http to this machine is its own case, the way Chromium treats it: a
 * loopback address is "potentially trustworthy" (nothing leaves the
 * computer), so it earns no warning, but the connection is still not
 * encrypted and the page's details say so.
 *
 * An https page on a site whose refused certificate the person let through
 * (`certificateExceptions`, hosts with their port) is `certificate`:
 * encrypted, but to whoever holds that certificate. Localhost is no
 * exception there: Chromium rates any page with a certificate error as
 * dangerous (`HasMajorCertificateError` in `security_state.cc`).
 */
export type PageConnection = "certificate" | "insecure" | "local" | "secure";

export function pageConnection(
  url: string,
  certificateExceptions: readonly string[] = [],
): PageConnection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "secure";
  }
  if (parsed.protocol === "https:") {
    return certificateExceptions.includes(parsed.host)
      ? "certificate"
      : "secure";
  }
  if (parsed.protocol !== "http:") {
    return "secure";
  }
  return isLocalhost(parsed) ? "local" : "insecure";
}
