import { bookmarksAtom } from "@/client/bookmarks/store";
import { useRecentPages } from "@/client/hooks/use-browser-history";
import { fuzzyMatch } from "@/client/lib/fuzzy-match";
import { useAtomValue } from "jotai";
import { unique } from "radashi";

import { bareAddress } from "./omnibar-match";

/** A page a field can offer to open: a bookmark, or one the person visited. */
export interface OfferedPage {
  favicon: string | undefined;
  title: string;
  url: string;
}

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

/** The pages the words find, best first, by the title a row shows or by the address. */
export function matchKnownPages<T extends { title: string; url: string }>(
  pages: T[],
  words: string,
): { item: T; ranges: null | number[] }[] {
  return fuzzyMatch(
    pages,
    (page) => [page.title || bareAddress(page.url), page.url],
    words,
  );
}
