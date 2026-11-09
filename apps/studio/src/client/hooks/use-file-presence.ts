import { useEffect, useState } from "react";

import { useNearViewport } from "./use-near-viewport";

/**
 * What a card says of a file the origin no longer has. Moved or deleted, it
 * cannot tell which, and "missing" is the word file surfaces use for that.
 */
export const FILE_MISSING_LABEL = "Missing";

/**
 * Whether the file a card stands for is still where the card says.
 *
 * A transcript is a record of what a reply handed over, so the card stays
 * whatever became of the file; what changes is how it is drawn. The origin is
 * asked with a HEAD request, and only once the card has come near the
 * viewport, so a long transcript costs nothing on open and one bodiless
 * request per card the reader actually reaches. Not a range: no range fits an
 * empty file, which the origin answers with a 416. A 404 is the only answer that
 * means gone: an origin that is down, or a request cut off, says nothing about
 * the file and leaves the card as it was. Asked again when the url changes,
 * which is how a file rewritten since is looked at afresh.
 */
export function useFilePresence<T extends HTMLElement>(
  url: string | undefined,
): { isMissing: boolean; ref: React.RefObject<null | T> } {
  const { isNear, ref } = useNearViewport<T>();
  const [missingUrl, setMissingUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!isNear || url === undefined) {
      return;
    }
    const controller = new AbortController();
    void isGone(url, controller.signal).then((gone) => {
      if (gone) {
        setMissingUrl(url);
      }
    });
    return () => {
      controller.abort();
    };
  }, [isNear, url]);

  return { isMissing: url !== undefined && missingUrl === url, ref };
}

/** Whether the origin answers `url` with a 404, the one answer that means gone. */
async function isGone(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    return response.status === 404 && !signal.aborted;
  } catch {
    // Not the file's absence.
    return false;
  }
}
