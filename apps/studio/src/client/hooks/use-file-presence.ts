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
 * asked with a one-byte range request, and only once the card has come near
 * the viewport, so a long transcript costs nothing on open and one small
 * request per card the reader actually reaches. A 404 is the only answer that
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
    void (async () => {
      try {
        const response = await fetch(url, {
          headers: { Range: "bytes=0-0" },
          signal: controller.signal,
        });
        if (response.status === 404 && !controller.signal.aborted) {
          setMissingUrl(url);
        }
      } catch {
        // Not the file's absence.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [isNear, url]);

  return { isMissing: missingUrl === url, ref };
}
