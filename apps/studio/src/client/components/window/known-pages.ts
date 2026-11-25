import { bookmarksAtom } from "@/client/bookmarks/store";
import { targetOfAddress } from "@/client/bookmarks/address";
import {
  useCompletionPages,
  useRecentPages,
} from "@/client/hooks/use-browser-history";
import { useAtomValue } from "jotai";
import { unique } from "radashi";

import { type OfferedPage } from "./omnibar-match";

/**
 * The pages the command menu and a new tab's box offer to open: the
 * bookmarks, then the pages visited that are not bookmarked, newest first,
 * each once. `visited` is history as it came, with when each was seen.
 * Read only while `enabled`.
 */
export function useKnownPages({ enabled }: { enabled: boolean }) {
  const visited = useRecentPages({ enabled });
  const bookmarks = useAtomValue(bookmarksAtom);
  const bookmarkPages: OfferedPage[] = unique(
    bookmarks.map((bookmark) => ({
      favicon: undefined,
      title: bookmark.title,
      url: bookmark.url,
    })),
    (page) => page.url,
  );
  const bookmarked = new Set(bookmarkPages.map((page) => page.url));
  const recentPages: OfferedPage[] = unique(
    visited
      .filter((page) => !bookmarked.has(page.url))
      .map((page) => ({
        favicon: page.favicon,
        title: page.title,
        url: page.url,
      })),
    (page) => page.url,
  );
  return { bookmarkPages, recentPages, visited };
}

/**
 * The web pages the address field and a new tab's box know, bookmarks ahead
 * of history: `completable` is what they finish words to, whose history is
 * the pages the person goes back to (Chromium's significant ones), and
 * `offered` what they list, whose history is every page visited, newest
 * first. The app's own places kept as bookmarks are no web pages. Read only
 * while `enabled`.
 */
export function useFieldPages({ enabled }: { enabled: boolean }): {
  completable: OfferedPage[];
  offered: OfferedPage[];
} {
  const { bookmarkPages, recentPages } = useKnownPages({ enabled });
  const significant = useCompletionPages({ enabled });
  const bookmarked = bookmarkPages.filter(
    (page) => targetOfAddress(page.url)?.kind === "page",
  );
  return {
    completable: unique(
      [...bookmarked, ...significant],
      (page) => page.url,
    ).map(({ favicon, title, url }) => ({ favicon, title, url })),
    offered: [...bookmarked, ...recentPages],
  };
}
