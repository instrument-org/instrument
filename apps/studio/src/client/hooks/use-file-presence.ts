import { useEffect, useState } from "react";

import { useNearViewport } from "./use-near-viewport";

/**
 * What a card says of a file the origin no longer has. Moved or deleted, it
 * cannot tell which, and "missing" is the word file surfaces use for that.
 */
export const FILE_MISSING_LABEL = "Missing";

/**
 * Whether the file a card stands for is still where the card says, and how
 * big it is once the origin has said.
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
): { isMissing: boolean; ref: React.RefObject<null | T>; size?: number } {
  const { isNear, ref } = useNearViewport<T>();
  const [found, setFound] = useState<FoundFile & { url?: string }>({});

  useEffect(() => {
    if (!isNear || url === undefined) {
      return;
    }
    const controller = new AbortController();
    void findFile(url, controller.signal).then((answer) => {
      if (!controller.signal.aborted) {
        setFound({ ...answer, url });
      }
    });
    return () => {
      controller.abort();
    };
  }, [isNear, url]);

  const isAnswered = url !== undefined && found.url === url;
  return {
    isMissing: isAnswered && found.isGone === true,
    ref,
    size: isAnswered ? found.size : undefined,
  };
}

/** What the origin says of a file: nothing, when it could not be asked. */
interface FoundFile {
  isGone?: boolean;
  size?: number;
}

async function findFile(url: string, signal: AbortSignal): Promise<FoundFile> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    const length = response.headers.get("content-length");
    return {
      isGone: response.status === 404,
      size: response.ok && length !== null ? Number(length) : undefined,
    };
  } catch {
    // Not the file's absence.
    return {};
  }
}
