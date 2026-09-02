import { LRUCache } from "lru-cache";
import ms from "ms";

/**
 * A short-lived memory of pages `web_fetch` already has.
 *
 * The same URL gets requested more than once for reasons that have nothing to
 * do with the page changing: a model batches parallel calls that overlap, comes
 * back to a source after reading something else, retries a step, or two tasks
 * in the same workspace research the same thing. Every one of those is a
 * request the site did not need to serve and a wait the user did not need.
 *
 * Memory only, deliberately. The gateway's model lists are cached in both
 * places, and the reason the disk half of that exists does not apply here: a
 * model list has to be there at startup for the picker to render, so a stale
 * one beats an unreachable provider. Nothing about a fetched page is load
 * bearing at boot -- a miss costs one request, mid-task, when an agent asks --
 * and putting third-party page content on the user's disk outside the task
 * folder would be a retention decision rather than an implementation detail.
 *
 * Kept small in every dimension, because a fetch cache that outlives the reason
 * for it becomes a way to read something that is no longer true. The window is
 * minutes, only bodies that came back whole and successful go in, and a hit
 * says so in the tool result rather than passing itself off as a fresh request.
 */

/**
 * How long a page stays worth reusing.
 *
 * Long enough to cover the repeats that actually happen -- the session this was
 * built for made six overlapping requests inside 1.3 seconds, then came back to
 * the same URLs about two and four minutes later -- and short enough that a
 * page which genuinely moves is not read stale twice in a row. A hit reports
 * its age, so the model can discount one it thinks is too old.
 */
export const CACHE_TTL_SECONDS = 300;
const TTL_MS = ms(`${CACHE_TTL_SECONDS} seconds`);

/**
 * The ceiling, in characters of decoded body held at once.
 *
 * Measured rather than assumed, because the number of characters is not the
 * number of bytes: V8 stores a string of pure Latin-1 at one byte per
 * character and anything else at two. Four million characters split across
 * sixteen entries measured 3.9 MB of heap as ASCII and 7.8 MB with every
 * character outside Latin-1, so 8 MB is the real worst case and the typical
 * case is half of it. Both are noise beside an Electron main process, and both
 * are bounded rather than growing.
 */
const MAX_CHARACTERS = 4_000_000;

/**
 * A cap on entries as well as total size, so one enormous page cannot evict
 * every small one and a burst of tiny fetches cannot hold hundreds of keys.
 */
const MAX_ENTRIES = 16;

/**
 * Pages past this are not held at all. The largest fetch a caller can ask for
 * returns 50,000 characters of converted markdown, and the raw body behind that
 * is several times larger; past a quarter of a megabyte one entry would take
 * most of the ceiling and push out everything else.
 */
const MAX_BODY_CHARACTERS = 256_000;

interface CachedPage {
  body: string;
  contentType: string;
  finalUrl: string;
  storedAt: number;
}

/**
 * `lru-cache` rather than a hand-rolled Map, matching the gateway's
 * `createResultCache`. It sweeps expired entries rather than only dropping one
 * when its own key is read again, which is the difference between a bounded
 * cache and sixteen stale pages held until something else needs the room.
 */
const pages = new LRUCache<string, CachedPage>({
  max: MAX_ENTRIES,
  maxSize: MAX_CHARACTERS,
  sizeCalculation: (page) => page.body.length,
  ttl: TTL_MS,
});

/**
 * Hold a successfully fetched page. Callers pass only 2xx bodies: a refusal can
 * be cleared by the user completing a challenge, and a cached one would outlast
 * the fix and keep reporting a wall that is no longer there.
 */
export function cachePage({
  body,
  contentType,
  finalUrl,
  url,
}: {
  body: string;
  contentType: string;
  finalUrl: string;
  url: string;
}): void {
  if (body.length > MAX_BODY_CHARACTERS || body.length === 0) {
    return;
  }
  pages.set(url, { body, contentType, finalUrl, storedAt: Date.now() });
}

/** Drop everything held. For tests, which must not inherit each other's pages. */
export function clearCachedPages(): void {
  pages.clear();
}

/**
 * The page held for this URL, or undefined when there is none worth serving.
 *
 * Reports the age of what it returns so the caller can say so: a cached body
 * that arrives looking like a fresh request is the kind of quiet substitution
 * that makes a model confident about something it has no reason to be.
 */
export function readCachedPage(url: string):
  | undefined
  | {
      ageMs: number;
      body: string;
      contentType: string;
      finalUrl: string;
    } {
  const entry = pages.get(url);
  return entry
    ? {
        ageMs: Date.now() - entry.storedAt,
        body: entry.body,
        contentType: entry.contentType,
        finalUrl: entry.finalUrl,
      }
    : undefined;
}
