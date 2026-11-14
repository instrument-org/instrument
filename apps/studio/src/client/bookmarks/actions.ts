import {
  type Bookmark,
  type BookmarkPlace,
  orderAfter,
  placeOf,
} from "@/shared/bookmarks";
import { toast } from "@/client/lib/toast";
import { useAtomValue, useSetAtom, useStore } from "jotai";

import { sameAddress } from "./address";
import { applyBookmarkOpsAtom, bookmarksAtom } from "./store";

export { addressOfTab } from "./address";

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

/**
 * Keeping an address from a menu over a link or a file, for a surface that
 * draws many: the bookmarks are read at the press rather than followed, so
 * a change to them redraws none of the links. An address not kept yet goes
 * last on the bookmarks bar, and one kept already stays where it is; the
 * toast says which.
 */
export function useAddBookmark() {
  const store = useStore();
  return ({ title, url }: { title: string; url: string }) => {
    const bookmarks = store.get(bookmarksAtom);
    const kept = bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
    if (kept) {
      toast("Already in Bookmarks", { description: kept.title || url });
      return;
    }
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      order: orderAfter(bookmarks),
      title,
      url,
    };
    void store.set(applyBookmarkOpsAtom, [{ bookmark, type: "add" }]);
    toast("Added to Bookmarks", { description: title || url });
  };
}
