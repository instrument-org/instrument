/**
 * How a page's source goes into a document as it arrives: the document is
 * opened once and each update writes only what is new, so the browser's own
 * parser draws the page as it comes, tags not closed yet included, and the
 * frame never reloads.
 *
 * A page from the page skill names its angle in a direction comment under its
 * doctype and gets its stylesheet only when `page.mjs` builds it, after the
 * write. So the foundation goes in where the build would put it, straight
 * after `<head>`, until the source carries a block of its own. The start of
 * the source waits until where it goes is known, a few hundred characters in.
 */

/** What a document has been written so far. */
export interface PageFeed {
  /** The document was closed, its page whole. */
  closed: boolean;
  /**
   * Where in the source the foundation went in: an index, or false for
   * nowhere. Unsettled while the source still holds back.
   */
  foundationAt?: false | number;
  /** The source written so far, or nothing before the document is opened. */
  written?: string;
}

/** What to do to the document for a new source. */
export interface FeedStep {
  close: boolean;
  feed: PageFeed;
  /** Open the document afresh before writing. */
  open: boolean;
  /** What to write, in order, `null` standing for the foundation. */
  pieces: (null | string)[];
}

export const NEW_FEED: PageFeed = { closed: false };

const DIRECTION = "<!-- direction:";
const FOUNDATION_BLOCK = "<!-- foundation:start";
/** Past this much source with no head, a page has none to wait for. */
const SETTLE_BY = 4096;

/**
 * The next step for a document fed `feed`, now that the source is `source`.
 * `isComplete` says the source is whole, which closes the document. A source
 * that no longer starts with what was written opens the document afresh.
 */
export function feedPage(
  feed: PageFeed,
  source: string,
  isComplete: boolean,
): FeedStep {
  const isSame = feed.written === source;
  if (feed.closed && isSame) {
    return { close: false, feed, open: false, pieces: [] };
  }
  const isFresh =
    feed.written === undefined ||
    feed.closed ||
    !source.startsWith(feed.written);
  const from: PageFeed = isFresh ? { closed: false, written: "" } : feed;
  const foundationAt = from.foundationAt ?? foundationPlace(source, isComplete);
  if (foundationAt === undefined) {
    return { close: false, feed: from, open: isFresh, pieces: [] };
  }
  const written = from.written ?? "";
  const pieces =
    from.foundationAt === undefined && foundationAt !== false
      ? [source.slice(0, foundationAt), null, source.slice(foundationAt)]
      : [source.slice(written.length)];
  return {
    close: isComplete,
    feed: { closed: isComplete, foundationAt, written: source },
    open: isFresh,
    pieces: pieces.filter((piece) => piece !== ""),
  };
}

/**
 * Where the page skill's foundation goes in a source: an index, false for
 * a page that needs none, or nothing while the source cannot say yet.
 */
export function foundationPlace(
  source: string,
  isComplete: boolean,
): false | number | undefined {
  if (source.includes(FOUNDATION_BLOCK)) {
    return false;
  }
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  const hasBody = /<body[\s>]/i.test(source);
  const isPastTop =
    isComplete || head !== null || hasBody || source.length >= SETTLE_BY;
  const direction = source.indexOf(DIRECTION);
  if (direction === -1 || (head !== null && direction > head.index)) {
    return isPastTop ? false : undefined;
  }
  if (head) {
    const after = head.index + head[0].length;
    // A page built before carries its block straight after its head.
    const next = source.slice(after).trimStart();
    return !isComplete && FOUNDATION_BLOCK.startsWith(next) ? undefined : after;
  }
  if (!isPastTop) {
    return undefined;
  }
  // No head: after the comment, where the parser opens one for it.
  const end = source.indexOf("-->", direction);
  return end === -1 ? (isComplete ? false : undefined) : end + 3;
}
