/**
 * Where a site's icon was last found, remembered across launches.
 *
 * An icon is read from the proxy first, then from the site itself, then from
 * nowhere, and every step down that chain is a request that fails before the
 * next one is made. A site with no icon anywhere costs two failed requests
 * and a glyph that arrives late, and it costs them again on the next mount
 * and the next launch, which is a row of chips whose marks flicker in one at
 * a time every time the app opens. Remembering the answer per host makes the
 * second reading, and every reading after a launch, land where the first one
 * ended.
 *
 * Only the deviations are kept: the proxy is where a site is looked for by
 * default, so a host not in the memory is one whose icon the proxy serves, or
 * one never asked about. What is kept expires, so a site that gains an icon
 * is found again, and nothing is remembered while the network is down, since
 * an icon that could not be fetched is not an icon the site lacks.
 */

/** Where the icon is being read from: the proxy, then the site itself, then nowhere. */
export type FaviconSource = "none" | "proxy" | "site";

const STORAGE_KEY = "studio.favicon-memory.v1";

/** How long a remembered answer holds: a fortnight for none, longer for a site serving its own. */
const NONE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SITE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

interface Entry {
  at: number;
  source: "none" | "site";
}

let memory: Map<string, Entry> | undefined;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Forgets everything, for a test or a reset. */
export function forgetFaviconSources() {
  memory = new Map();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to forget where nothing could be kept.
  }
}

/** Where a site's icon was last found, or the proxy for a site not yet asked about or whose answer has expired. */
export function rememberedFaviconSource(url: string): FaviconSource {
  const entry = load().get(hostOf(url));
  if (!entry) {
    return "proxy";
  }
  const ttl = entry.source === "none" ? NONE_TTL_MS : SITE_TTL_MS;
  return Date.now() - entry.at > ttl ? "proxy" : entry.source;
}

/**
 * Records where a site's icon turned out to be. The proxy is the default and
 * is forgotten rather than stored; nothing is stored while offline, when a
 * failed fetch says nothing about the site.
 */
export function rememberFaviconSource(url: string, source: FaviconSource) {
  if (!navigator.onLine) {
    return;
  }
  const host = hostOf(url);
  const store = load();
  if (source === "proxy") {
    if (!store.delete(host)) {
      return;
    }
  } else {
    store.set(host, { at: Date.now(), source });
  }
  save();
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname : url;
}

function load(): Map<string, Entry> {
  if (memory) {
    return memory;
  }
  memory = new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        memory = new Map(Object.entries(parsed as Record<string, Entry>));
      }
    }
  } catch {
    // Storage unreadable or the entry malformed: start over.
  }
  return memory;
}

function save() {
  // A page of chips settles many hosts at once; one write covers them all.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Object.fromEntries(load())),
      );
    } catch {
      // Storage full or unavailable: the memory still serves this session.
    }
  }, 250);
}
