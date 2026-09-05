import { app, type Session, type WebContents } from "electron";

// Present the identity of an ordinary Chromium-derived desktop browser for a
// session's outbound requests. Electron's own User-Agent departs from what any
// shipping browser sends in two ways, and some third-party services respond
// differently to it -- rate-limiting avatar/asset loads, or handling sign-in
// inconsistently. Two steps per session:
//
//   1. session.setUserAgent(ua): drop the `Electron/<ver>` token, which names
//      the framework rather than the browser, and reduce the Chrome version to
//      the `<major>.0.0.0` form Chromium has sent since the Chrome 110 UA
//      reduction. This updates both the outbound User-Agent header and the
//      in-page navigator.userAgent.
//   2. onBeforeSendHeaders: add the sec-ch-ua* client hints, on the requests
//      Chromium would attach them to. Electron returns a null
//      ClientHintsControllerDelegate, so its network stack never emits these
//      headers on its own -- a Chrome-shaped UA that sends no client hints at
//      all is the anomaly this step removes.
//
// The UA is derived by editing the real one rather than hand-writing it, so the
// AppleWebKit/Chrome/Safari tokens and the real Chromium major stay accurate and
// feature detection keeps working.
//
// The identity obeys one rule: it names what this browser is. The app's own
// product token stays in the UA, which is what makes this a browser that names
// itself rather than one impersonating Chrome -- and that claim is checkable, so
// a browser making it has to survive the check. Google's sign-in refuses a UA
// with no product token for exactly that reason; see
// docs/findings/a-bare-chrome-identity-is-what-google-refuses.md.
//
// The brand list follows the UA. A session whose pages can also move -- one with
// an attached debugger, through applyProductBrandedMetadata -- names the app
// alongside Chromium on both surfaces, the way every other Chromium-derived
// browser does. One without keeps the engine's own brands on both, because a
// header naming a brand the page denies is the contradiction this module exists
// to prevent. Neither path writes to the page.

const CHROME_VERSION = /\b(?:Chrome|Chromium)\/(\d+)\./;

// The app's own product token, which Electron places immediately before
// `Chrome/`: `<AppName>/<ver>`. Read back out of the UA rather than from
// app.getName()/getVersion() so the brand list and the UA cannot drift, and so
// a dev build's suffixed name ("Instrument(Dev)") carries through unchanged.
const PRODUCT_TOKEN = / (\S[^\s/]*)\/(\S+)(?= Chrome\/)/;

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

// Give a guest's pages the userAgentData its headers claim. Requires an attached
// debugger, so this is the half of the pair that the app's own session cannot
// have, and it must run before the first real navigation.
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
export function applyProductBrandedMetadata(wc: WebContents): void {
  const userAgent = normalizeUserAgent(wc.getUserAgent());
  const metadata = userAgentMetadata({
    arch: process.arch,
    chromeVersion: process.versions.chrome,
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
// `productBranded` belongs only to a session whose pages also get the matching
// metadata through applyProductBrandedMetadata. The app's own session cannot: no
// debugger is attached to it, so its page would keep reporting Chromium alone
// while its headers named the app too.
export function applyStandardUserAgent(
  ses: Session,
  { productBranded = false }: { productBranded?: boolean } = {},
): void {
  const cleanUserAgent = normalizeUserAgent(ses.getUserAgent());
  ses.setUserAgent(cleanUserAgent, preferredAcceptLanguage());
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({
      requestHeaders: standardUserAgentHeaders({
        acceptLanguage: preferredAcceptLanguage(),
        platform: process.platform,
        productBranded,
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

// Electron's default User-Agent:
//   ...(KHTML, like Gecko) <AppName>/<ver> Chrome/<full> Electron/<ver> Safari/537.36
// Remove the Electron token, which names the framework and not the browser, and
// reduce `Chrome/<full>` to `<major>.0.0.0` -- the build and patch numbers
// Chromium froze in the Chrome 110 UA reduction, which no shipping Chromium
// browser has sent since. What is left is the shape they all ship: a product
// token, a reduced Chrome version, and the real AppleWebKit/Safari tokens.
//
// The app-name token stays, and is the point rather than an oversight.
//
// Idempotent: an already-reduced version re-reduces to itself, and a UA with no
// Electron token no-ops.
export function normalizeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/(\bChrome\/\d+)\.\d+\.\d+\.\d+/, "$1.0.0.0")
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

// The app's brand entry for the client-hint brand list, read out of the UA's
// product token. Chromium reports a brand's significant version, so the entry
// takes the token's major and keeps the full one for `fullVersionList`.
export function productBrand(
  userAgent: string,
): null | { brand: string; fullVersion: string; version: string } {
  const match = PRODUCT_TOKEN.exec(userAgent);
  const brand = match?.[1];
  const fullVersion = match?.[2];
  if (brand == null || fullVersion == null) {
    return null;
  }
  return {
    brand,
    fullVersion,
    version: fullVersion.split(".")[0] ?? fullVersion,
  };
}

// The brand list Chromium generates for a given major version, in the order it
// generates it. `sec-ch-ua` has to serialize whatever the page reports through
// navigator.userAgentData for the two surfaces to describe the same browser.
//
// `product` adds the app's own brand beside Chromium, which is what every
// Chromium-derived browser does with its own name. It belongs only to a session
// whose page-side metadata we also set (see userAgentMetadata); without that
// second half it would name a brand the page denies, which is the mismatch this
// module exists to prevent -- so it travels with the override, never on its own.
export function secChUaBrands(
  major: number,
  { product }: { product?: null | { brand: string; version: string } } = {},
): { brand: string; version: string }[] {
  const grease = {
    brand: `Not${cycle(GREASE_CHARS, major)}A${cycle(GREASE_CHARS, major + 1)}Brand`,
    version: cycle(GREASE_VERSIONS, major),
  };
  const generated = [grease, { brand: "Chromium", version: String(major) }];
  if (product != null) {
    generated.push({ brand: product.brand, version: product.version });
  }
  return scatterBrands(generated, major);
}

// Serialize the brand list for the Chrome major version left in the UA. Returns
// null when no Chrome/Chromium version is present to derive from.
export function secChUaHeader(
  userAgent: string,
  options?: { product?: null | { brand: string; version: string } },
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
  platform,
  productBranded = false,
  requestHeaders,
  url,
  userAgent,
}: {
  acceptLanguage: string;
  platform: NodeJS.Platform;
  productBranded?: boolean;
  requestHeaders: Record<string, string>;
  url: string;
  userAgent: string;
}): Record<string, string> {
  const cleanUserAgent = normalizeUserAgent(userAgent);
  const hinted = isPotentiallyTrustworthy(url);
  const secChUa = secChUaHeader(cleanUserAgent, {
    product: productBranded ? productBrand(cleanUserAgent) : null,
  });

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
//
// `chromeVersion` is process.versions.chrome, not the UA's version, because the
// UA carries the reduced `<major>.0.0.0` while the high-entropy hints report the
// real build -- which is the same split a real Chrome makes.
export function userAgentMetadata({
  arch,
  chromeVersion,
  platform,
  systemVersion,
  userAgent,
}: {
  arch: string;
  chromeVersion: string;
  platform: NodeJS.Platform;
  systemVersion: string;
  userAgent: string;
}): null | Record<string, unknown> {
  const major = CHROME_VERSION.exec(userAgent)?.[1];
  if (major == null) {
    return null;
  }
  const product = productBrand(userAgent);
  const brands = secChUaBrands(Number(major), { product });
  return {
    architecture: arch === "arm64" || arch === "arm" ? "arm" : "x86",
    bitness: arch.includes("32") ? "32" : "64",
    brands,
    fullVersion: chromeVersion,
    // Each brand reports its own full version: the app's from its product token,
    // the GREASE entry's padded out of its own rather than borrowed from the
    // engine, and Chromium's the real build. This is what Blink reports.
    fullVersionList: brands.map(({ brand, version }) => {
      if (brand === product?.brand) {
        return { brand, version: product.fullVersion };
      }
      return {
        brand,
        version: brand.startsWith("Not") ? `${version}.0.0.0` : chromeVersion,
      };
    }),
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
