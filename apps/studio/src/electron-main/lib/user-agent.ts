import { app, type Session, type WebContents } from "electron";

// Present a standard desktop Chrome User-Agent for a session's outbound
// requests. Some third-party services respond differently to the default
// Electron User-Agent -- for example rate-limiting avatar/asset loads, or
// handling sign-in inconsistently -- so we normalize the session to look like an
// ordinary Chrome install for compatibility. Two steps per session:
//
//   1. session.setUserAgent(ua): remove the Electron and app-name product
//      tokens from the session's real UA. This updates both the outbound
//      User-Agent header and the in-page navigator.userAgent.
//   2. onBeforeSendHeaders: add the sec-ch-ua* client hints, on the requests
//      Chromium would attach them to. Electron returns a null
//      ClientHintsControllerDelegate, so its network stack never emits these
//      headers on its own -- a Chrome-shaped UA that sends no client hints at
//      all is the anomaly this step removes.
//
// The UA is derived by removing tokens from the real UA rather than
// hand-writing one, so the AppleWebKit/Chrome/Safari tokens and the real
// Chromium version stay accurate and feature detection keeps working.
//
// The brand list obeys one rule: a site reading both surfaces sees one browser.
// Which browser that is depends on whether the page half can move too. A session
// with an attached debugger gets Chrome on both, through
// applyChromeBrandedMetadata; one without keeps the engine's own brands on both,
// because a header naming a browser the page denies is the contradiction this
// module exists to prevent. Neither path writes to the page.

const CHROME_VERSION = /\b(?:Chrome|Chromium)\/(\d+)\./;

const CHROME_FULL_VERSION = /\b(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/;

// Chromium derives its brand list from the major version alone: the real brand
// entries plus a GREASE entry whose punctuation, version, and position in the
// list all cycle with that major, so the list stays stable per release while
// staying unparsable as a vendor name.
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];

// Chromium builds the list in a fixed order and then scatters it by
// `shuffled[order[i]] = list[i]`, picking the permutation with `major % count`.
// Reproduced rather than approximated because the permutation is what decides
// list order, and an order that disagrees with the page is the contradiction
// this whole module exists to avoid. Verified against a real Chrome: major 152
// takes `{1, 0, 2}` here and reports Chromium, GREASE, Google Chrome.
const BRAND_ORDERS: Record<number, number[][]> = {
  2: [
    [0, 1],
    [1, 0],
  ],
  3: [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ],
};

// Loopback hosts, which are potentially trustworthy whatever their scheme.
// Chromium counts the whole 127.0.0.0/8 range and every `.localhost` name.
const LOOPBACK_HOST = /^(?:\[::1\]|127(?:\.\d{1,3}){3}|localhost)$/;

// Give a guest's pages the Chrome-branded userAgentData its headers claim.
// Requires an attached debugger, so this is the half of the pair that the app's
// own session cannot have, and it must run before the first real navigation.
//
// `acceptLanguage` rides along because it is the only thing that moves
// navigator.languages: session.setUserAgent's own accept-language argument
// reaches the header and stops there, so setting one without the other leaves
// the page listing languages its requests do not ask for. `platform` is left off
// so Blink keeps its own navigator.platform, which is already right.
//
// The override lives on the page target for as long as the debugger stays
// attached, so one call per guest is enough -- but it does not reach
// out-of-process subframes, which keep reporting the engine's own brands.
export function applyChromeBrandedMetadata(wc: WebContents): void {
  const userAgent = normalizeUserAgent(wc.getUserAgent());
  const metadata = userAgentMetadata({
    arch: process.arch,
    platform: process.platform,
    systemVersion: process.getSystemVersion(),
    userAgent,
  });
  if (metadata == null) {
    return;
  }
  wc.debugger
    .sendCommand("Emulation.setUserAgentOverride", {
      acceptLanguage: preferredEmulatedLanguages(),
      userAgent,
      userAgentMetadata: metadata,
    })
    .catch(() => {
      // A guest torn down mid-attach is the ordinary case here, and a guest
      // that keeps the engine's brands is a worse identity, not a broken one.
    });
}

// Apply the normalized User-Agent to a session: clean the UA (both the outbound
// header and in-page navigator.userAgent via setUserAgent) and add matching
// client hints. Re-callable -- setUserAgent and the single onBeforeSendHeaders
// listener are both overwriting, so re-invoking on a reused session object (e.g.
// sessionForEntry on every guest attach) just re-applies the same values.
// `chromeBranded` belongs only to a session whose pages also get the matching
// metadata through applyChromeBrandedMetadata. The app's own session cannot: no
// debugger is attached to it, so its page would keep reporting Chromium while
// its headers claimed otherwise.
export function applyStandardUserAgent(
  ses: Session,
  { chromeBranded = false }: { chromeBranded?: boolean } = {},
): void {
  const cleanUserAgent = normalizeUserAgent(ses.getUserAgent());
  ses.setUserAgent(cleanUserAgent, preferredAcceptLanguage());
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: standardUserAgentHeaders({
        acceptLanguage: preferredAcceptLanguage(),
        chromeBranded,
        platform: process.platform,
        requestHeaders: details.requestHeaders,
        url: details.url,
        userAgent: ses.getUserAgent(),
      }),
    });
  });
}

// Whether Chromium would attach client hints to a request for this URL. It
// restricts them to potentially trustworthy origins, so hinting a plain http://
// request is a header no real Chrome sends -- the same kind of contradiction as
// naming a brand the page denies, pointed the other way.
export function isPotentiallyTrustworthy(url: string): boolean {
  const parsed = URL.parse(url);
  if (parsed == null) {
    return false;
  }
  return (
    parsed.protocol === "https:" ||
    parsed.protocol === "wss:" ||
    LOOPBACK_HOST.test(parsed.hostname) ||
    parsed.hostname.endsWith(".localhost")
  );
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
// generates it. `sec-ch-ua` has to serialize whatever the page reports through
// navigator.userAgentData for the two surfaces to describe the same browser.
//
// `chromeBranded` produces the list a Google Chrome build reports, for a session
// whose page-side metadata we also set (see userAgentMetadata). Without that
// second half it would name a browser the page denies, which is the mismatch
// this module exists to prevent -- so the flag travels with the override, never
// on its own.
export function secChUaBrands(
  major: number,
  { chromeBranded = false }: { chromeBranded?: boolean } = {},
): { brand: string; version: string }[] {
  const grease = {
    brand: `Not${cycle(GREASE_CHARS, major)}A${cycle(GREASE_CHARS, major + 1)}Brand`,
    version: cycle(GREASE_VERSIONS, major),
  };
  const generated = [grease, { brand: "Chromium", version: String(major) }];
  if (chromeBranded) {
    generated.push({ brand: "Google Chrome", version: String(major) });
  }
  return scatterBrands(generated, major);
}

// Serialize the brand list for the Chrome major version left in the UA. Returns
// null when no Chrome/Chromium version is present to derive from.
export function secChUaHeader(
  userAgent: string,
  options?: { chromeBranded?: boolean },
): null | string {
  const major = CHROME_VERSION.exec(userAgent)?.[1];
  return major == null
    ? null
    : secChUaBrands(Number(major), options)
        .map(({ brand, version }) => `"${brand}";v="${version}"`)
        .join(", ");
}

// Pure core: given the request's headers and the inputs, return a new header map
// with the normalized UA and consistent client hints. Exported for unit testing
// without touching Electron.
export function standardUserAgentHeaders({
  acceptLanguage,
  chromeBranded = false,
  platform,
  requestHeaders,
  url,
  userAgent,
}: {
  acceptLanguage: string;
  chromeBranded?: boolean;
  platform: NodeJS.Platform;
  requestHeaders: Record<string, string>;
  url: string;
  userAgent: string;
}): Record<string, string> {
  const cleanUserAgent = normalizeUserAgent(userAgent);
  const hinted = isPotentiallyTrustworthy(url);
  const secChUa = secChUaHeader(cleanUserAgent, { chromeBranded });

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
  if (!hinted) {
    return headers;
  }
  if (secChUa != null) {
    headers["sec-ch-ua"] = secChUa;
  }
  headers["sec-ch-ua-mobile"] = "?0";
  headers["sec-ch-ua-platform"] = platformHint(platform);
  return headers;
}

// The `userAgentMetadata` for CDP's Emulation.setUserAgentOverride, which is how
// navigator.userAgentData gets a value without writing to the page. Blink serves
// the API from this, so the properties stay native and no descriptor or function
// source is disturbed -- the reason this is a correction rather than a disguise.
//
// Every field Blink derives itself is reproduced here rather than dropped,
// because an omitted field comes back empty rather than falling back, and a
// getHighEntropyValues() call that returns nothing is its own inconsistency.
// The platform values are Node-derivable: process.getSystemVersion() equals the
// platformVersion Blink reports, and process.arch gives the rest.
export function userAgentMetadata({
  arch,
  platform,
  systemVersion,
  userAgent,
}: {
  arch: string;
  platform: NodeJS.Platform;
  systemVersion: string;
  userAgent: string;
}): null | Record<string, unknown> {
  const major = CHROME_VERSION.exec(userAgent)?.[1];
  const fullVersion = CHROME_FULL_VERSION.exec(userAgent)?.[1];
  if (major == null || fullVersion == null) {
    return null;
  }
  const brands = secChUaBrands(Number(major), { chromeBranded: true });
  return {
    architecture: arch === "arm64" || arch === "arm" ? "arm" : "x86",
    bitness: arch.includes("32") ? "32" : "64",
    brands,
    fullVersion,
    // The GREASE entry pads its own version out instead of borrowing the
    // engine's, which is what Blink reports.
    fullVersionList: brands.map(({ brand, version }) => ({
      brand,
      version: brand.startsWith("Not") ? `${version}.0.0.0` : fullVersion,
    })),
    mobile: false,
    model: "",
    platform: platformHint(platform).replaceAll('"', ""),
    platformVersion: systemVersion,
    wow64: false,
  };
}

// Build a quality-weighted `Accept-Language` from an ordered preference list:
// the first language keeps q=1, each subsequent one drops 0.1 (floored at 0.1).
export function weightedAcceptLanguage(languages: string[]): string {
  return withBaseLanguages(languages)
    .map((language, index) =>
      index === 0
        ? language
        : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`,
    )
    .join(",");
}

// Follow each region-qualified tag with its bare base, which is what Chrome
// sends and, because Blink derives navigator.languages from this same string,
// what the page then reports. A system set to en-US gives `en-US,en;q=0.9` and
// `["en-US", "en"]`; sending the region alone leaves a one-entry languages list
// no ordinary install produces. Order is preserved and repeats are dropped, so a
// list already naming a base keeps its own position for it.
export function withBaseLanguages(languages: string[]): string[] {
  const expanded: string[] = [];
  for (const language of languages) {
    const base = language.split("-")[0];
    for (const tag of base == null || base === language
      ? [language]
      : [language, base]) {
      if (!expanded.includes(tag)) {
        expanded.push(tag);
      }
    }
  }
  return expanded;
}

function cycle(pool: string[], index: number): string {
  return pool[index % pool.length] ?? "";
}

function preferredAcceptLanguage(): string {
  return weightedAcceptLanguage(preferredLanguages());
}

// The same list the header carries, without quality weights. CDP splits this
// string on commas and hands the pieces to navigator.languages verbatim, so a
// weighted one puts the literal tag "en;q=0.9" in the page -- not a language any
// browser reports. Chrome makes the same distinction: weights on the header,
// bare tags in the page.
function preferredEmulatedLanguages(): string {
  return withBaseLanguages(preferredLanguages()).join(",");
}

function preferredLanguages(): string[] {
  const languages = app.getPreferredSystemLanguages();
  return languages.length > 0 ? languages : [app.getLocale()];
}

// Chromium's own shuffle: a scatter, so entry i lands at order[i] rather than
// being read from it. Reading it as a gather flips the three-brand orders that
// are not their own inverse.
function scatterBrands<T>(generated: T[], major: number): T[] {
  const orders = BRAND_ORDERS[generated.length];
  if (orders == null) {
    return generated;
  }
  const order = orders[major % orders.length] ?? [];
  const shuffled = [...generated];
  for (const [index, entry] of generated.entries()) {
    const target = order[index];
    if (target != null) {
      shuffled[target] = entry;
    }
  }
  return shuffled;
}
