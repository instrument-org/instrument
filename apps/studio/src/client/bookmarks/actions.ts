import {
  type Bookmark,
  type BookmarkPlace,
  orderAfter,
  placeOf,
} from "@/shared/bookmarks";
import { useAtomValue, useSetAtom } from "jotai";

import { sameAddress } from "./address";
import { applyBookmarkOpsAtom, bookmarksAtom } from "./store";

export { instrumentAddressOf } from "./address";

/**
 * Keeping any address as a bookmark, for whatever offers to: the star at
 * the end of the address field, ⌘D, a row's menu. An address is kept once,
 * however it is spelled (`sameAddress`), so keeping it again moves it to the
 * place asked for and returns the one already kept.
 */
export function useBookmarkActions() {
  const bookmarks = useAtomValue(bookmarksAtom);
  const applyBookmarkOps = useSetAtom(applyBookmarkOpsAtom);
  const bookmarkOf = (url: string) =>
    bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
  const place = (bookmark: Bookmark, where: BookmarkPlace) => {
    if (placeOf(bookmark) === where) {
      return;
    }
    // At the end of the place it goes to.
    void applyBookmarkOps([
      { id: bookmark.id, order: orderAfter(bookmarks), type: "place", where },
    ]);
  };
  return {
    /** Keeps `url` under `title` in `where` (the bar unless told), and returns the bookmark. */
    bookmark: ({
      title,
      url,
      where = "bar",
    }: {
      title: string;
      url: string;
      where?: BookmarkPlace;
    }): Bookmark => {
      const kept = bookmarkOf(url);
      if (kept) {
        place(kept, where);
        return kept;
      }
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        order: orderAfter(bookmarks),
        title,
        url,
        ...(where === "sidebar" ? { where } : {}),
      };
      void applyBookmarkOps([{ bookmark, type: "add" }]);
      return bookmark;
    },
    /** The bookmark kept for an address, if there is one. */
    bookmarkOf,
    /** Every bookmark, in order. */
    bookmarks,
    isBookmarked: (url: string) => bookmarkOf(url) !== undefined,
    /** Shows a bookmark on the bar or in the sidebar, last there. */
    place,
    remove: (bookmark: Bookmark) => {
      void applyBookmarkOps([{ id: bookmark.id, type: "remove" }]);
    },
    /** Renames a bookmark; a name left empty or unchanged keeps the old one. */
    rename: (bookmark: Bookmark, title: string) => {
      const named = title.trim();
      if (!named || named === bookmark.title) {
        return;
      }
      void applyBookmarkOps([
        { id: bookmark.id, title: named, type: "rename" },
      ]);
    },
  };
}
