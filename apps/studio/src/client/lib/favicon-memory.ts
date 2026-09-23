/**
 * Which sites have no icon, remembered across launches.
 *
 * An icon is read from the proxy, and a site the proxy has nothing for is
 * answered with its stand-in globe rather than an error. That answer costs a
 * request and a glyph that arrives late, and it costs them again on the next
 * mount and the next launch, which is a row of chips whose marks flicker in
 * one at a time every time the app opens. Remembering it per host makes every
 * later reading land where the first one ended.
 *
 * Only that answer is kept. A load that failed says nothing about the site,
 * only about the request, so it is never remembered: a blip would otherwise
 * strip a site of its icon everywhere for as long as the memory holds. What is
 * kept expires, so a site that gains an icon is found again, and nothing is
 * remembered while the network is down.
 */

import { z } from "zod";

/** Where the icon is read from: the proxy, or nowhere for a site it has none for. */
export type FaviconSource = "none" | "proxy";

const STORAGE_KEY = "studio.favicon-memory.v2";

/** How long a remembered absence holds. */
const NONE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const EntrySchema = z.object({
  at: z.number(),
  source: z.literal("none"),
});
type Entry = z.output<typeof EntrySchema>;

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
  return Date.now() - entry.at > NONE_TTL_MS ? "proxy" : entry.source;
}

/**
 * Records whether the proxy had an icon for a site. The proxy is the default
 * and is forgotten rather than stored; nothing is stored while offline.
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
      const parsed = z
        .record(z.string(), EntrySchema)
        .safeParse(JSON.parse(raw));
      if (parsed.success) {
        memory = new Map(Object.entries(parsed.data));
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
