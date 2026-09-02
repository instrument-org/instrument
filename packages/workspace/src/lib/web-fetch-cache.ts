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
 * Kept deliberately small in every dimension, because a fetch cache that
 * outlives the reason for it becomes a way to read something that is no longer
 * true. The window is minutes, only bodies that came back whole and successful
 * go in, and a hit says so in the tool result rather than passing itself off as
 * a fresh request.
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
const TTL_MS = ms("5 minutes");

/**
 * A hard ceiling on retained pages, since this holds decoded text in memory for
 * the life of the process. Sixteen entries at the size cap below is a four
 * megabyte worst case, reached only by sixteen unusually large pages at once.
 */
const MAX_ENTRIES = 16;

/**
 * Pages past this are not worth holding. The largest fetch a caller can ask for
 * returns 50,000 characters of converted markdown, and the raw body behind that
 * is several times larger; past a quarter of a megabyte the entry costs more
 * memory than the request it saves costs time.
 */
const MAX_BODY_CHARACTERS = 256_000;

interface CachedPage {
  body: string;
  contentType: string;
  finalUrl: string;
  storedAt: number;
}

const pages = new Map<string, CachedPage>();

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
  if (body.length > MAX_BODY_CHARACTERS) {
    return;
  }

  // Re-inserting moves the key to the end of the iteration order, so the first
  // key is always the least recently stored and eviction needs no timestamps.
  pages.delete(url);
  pages.set(url, { body, contentType, finalUrl, storedAt: Date.now() });

  while (pages.size > MAX_ENTRIES) {
    const oldest = pages.keys().next();
    if (oldest.done) {
      break;
    }
    pages.delete(oldest.value);
  }
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
  if (!entry) {
    return undefined;
  }

  const ageMs = Date.now() - entry.storedAt;
  if (ageMs >= TTL_MS) {
    pages.delete(url);
    return undefined;
  }

  return {
    ageMs,
    body: entry.body,
    contentType: entry.contentType,
    finalUrl: entry.finalUrl,
  };
}
