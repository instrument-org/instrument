import { app, type Session } from "electron";

// Present a standard desktop Chrome User-Agent for a session's outbound
// requests. Some third-party services respond differently to the default
// Electron User-Agent -- for example rate-limiting avatar/asset loads, or
// handling sign-in inconsistently -- so we normalize the session to look like an
// ordinary Chrome install for compatibility. Two steps per session:
//
//   1. session.setUserAgent(ua): remove the Electron and app-name product
//      tokens from the session's real UA. This updates both the outbound
//      User-Agent header and the in-page navigator.userAgent.
//   2. onBeforeSendHeaders: add the sec-ch-ua* client hints. Electron returns a
//      null ClientHintsControllerDelegate, so its network stack never emits
//      these headers on its own -- a Chrome-shaped UA that sends no client hints
//      at all is the anomaly this step removes.
//
// The UA is derived by removing tokens from the real UA rather than
// hand-writing one, so the AppleWebKit/Chrome/Safari tokens and the real
// Chromium version stay accurate and feature detection keeps working. The brand
// list follows the same rule: it reproduces what the engine reports in the page
// through navigator.userAgentData rather than naming a browser the page-side API
// contradicts, so a site reading both surfaces sees one identity.

const CHROME_VERSION = /\b(?:Chrome|Chromium)\/(\d+)\./;

// Chromium derives its brand list from the major version alone: a real
// "Chromium" entry plus a GREASE entry whose punctuation, version, and position
// in the list all cycle with that major, so the list stays stable per release
// while staying unparsable as a vendor name.
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];

// Apply the normalized User-Agent to a session: clean the UA (both the outbound
// header and in-page navigator.userAgent via setUserAgent) and add matching
// client hints. Re-callable -- setUserAgent and the single onBeforeSendHeaders
// listener are both overwriting, so re-invoking on a reused session object (e.g.
// sessionForEntry on every guest attach) just re-applies the same values.
export function applyStandardUserAgent(ses: Session): void {
  const cleanUserAgent = normalizeUserAgent(ses.getUserAgent());
  ses.setUserAgent(cleanUserAgent, preferredAcceptLanguage());
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: standardUserAgentHeaders({
        acceptLanguage: preferredAcceptLanguage(),
        platform: process.platform,
        requestHeaders: details.requestHeaders,
        userAgent: ses.getUserAgent(),
      }),
    });
  });
}

// Electron's default User-Agent is a standard Chrome UA with two extra product
// tokens:
//   ...(KHTML, like Gecko) <AppName>/<ver> Chrome/<ver> Electron/<ver> Safari/537.36
// Remove both extra tokens -- the app-name token sits immediately before
// `Chrome/`, the Electron token immediately after it -- leaving a standard Chrome
// UA with the real AppleWebKit/Chrome/Safari tokens and Chromium version intact,
// so feature detection keeps working.
//
// Removed by position rather than by name because app.getName() doesn't reliably
// equal the UA's app token -- dev/canary builds suffix it, so the UA carries
// "Instrument(Dev)" while getName() returns "Instrument", and a name-based
// removal silently misses it. Idempotent: a standard UA has no `/`-token before
// `Chrome/` and no Electron token, so both replacements no-op.
export function normalizeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/ \S[^\s/]*\/\S+(?= Chrome\/)/, "")
    .replace(/ Electron\/\S+/, "");
}

export function platformHint(platform: NodeJS.Platform): string {
  if (platform === "darwin") {
    return '"macOS"';
  }
  if (platform === "win32") {
    return '"Windows"';
  }
  return '"Linux"';
}

// The brand list Chromium generates for a given major version, in the order it
// generates it. Equal to what navigator.userAgentData.brands reports in the
// page, which is what `sec-ch-ua` has to serialize for the two surfaces to
// describe the same browser.
export function secChUaBrands(
  major: number,
): { brand: string; version: string }[] {
  const grease = {
    brand: `Not${cycle(GREASE_CHARS, major)}A${cycle(GREASE_CHARS, major + 1)}Brand`,
    version: cycle(GREASE_VERSIONS, major),
  };
  const chromium = { brand: "Chromium", version: String(major) };
  return major % 2 === 0 ? [grease, chromium] : [chromium, grease];
}

// Serialize the brand list for the Chrome major version left in the UA. Returns
// null when no Chrome/Chromium version is present to derive from.
export function secChUaHeader(userAgent: string): null | string {
  const major = CHROME_VERSION.exec(userAgent)?.[1];
  return major == null
    ? null
    : secChUaBrands(Number(major))
        .map(({ brand, version }) => `"${brand}";v="${version}"`)
        .join(", ");
}

// Pure core: given the request's headers and the inputs, return a new header map
// with the normalized UA and consistent client hints. Exported for unit testing
// without touching Electron.
export function standardUserAgentHeaders({
  acceptLanguage,
  platform,
  requestHeaders,
  userAgent,
}: {
  acceptLanguage: string;
  platform: NodeJS.Platform;
  requestHeaders: Record<string, string>;
  userAgent: string;
}): Record<string, string> {
  const cleanUserAgent = normalizeUserAgent(userAgent);
  const secChUa = secChUaHeader(cleanUserAgent);

  // Drop any case-variant of the headers we set below so we replace Chromium's
  // own values rather than emitting duplicates, then write the canonical keys.
  const overridden = new Set([
    "accept-language",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "user-agent",
  ]);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (!overridden.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  headers["User-Agent"] = cleanUserAgent;
  headers["Accept-Language"] = acceptLanguage;
  if (secChUa != null) {
    headers["sec-ch-ua"] = secChUa;
  }
  headers["sec-ch-ua-mobile"] = "?0";
  headers["sec-ch-ua-platform"] = platformHint(platform);
  return headers;
}

// Build a quality-weighted `Accept-Language` from an ordered preference list:
// the first language keeps q=1, each subsequent one drops 0.1 (floored at 0.1).
export function weightedAcceptLanguage(languages: string[]): string {
  return languages
    .map((language, index) =>
      index === 0
        ? language
        : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`,
    )
    .join(",");
}

function cycle(pool: string[], index: number): string {
  return pool[index % pool.length] ?? "";
}

function preferredAcceptLanguage(): string {
  const languages = app.getPreferredSystemLanguages();
  return weightedAcceptLanguage(
    languages.length > 0 ? languages : [app.getLocale()],
  );
}
