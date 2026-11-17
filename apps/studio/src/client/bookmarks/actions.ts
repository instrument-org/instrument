import {
  type Bookmark,
  OTHER_ROOT_TITLE,
  sortedAddOps,
} from "@/shared/bookmarks";
import { toast } from "@/client/lib/toast";
import { useAtomValue, useSetAtom, useStore } from "jotai";

import { sameAddress, sortedKindOf } from "./address";
import { newBookmarkPlace } from "./edit";
import {
  applyBookmarkOpsAtom,
  bookmarksStateAtom,
  lastBookmarkFolderAtom,
} from "./store";

export { addressOfTab } from "./address";

/**
 * The bookmarks as the address field's star and ⌘D keep and show them: an
 * address is kept once, however it is spelled (`sameAddress`), so keeping
 * it again returns the one already kept.
 */
export function useBookmarkActions() {
  const state = useAtomValue(bookmarksStateAtom);
  const { bookmarks } = state;
  const applyBookmarkOps = useSetAtom(applyBookmarkOpsAtom);
  const lastFolder = useAtomValue(lastBookmarkFolderAtom);
  const bookmarkOf = (url: string) =>
    bookmarks.find((bookmark) => sameAddress(bookmark.url, url));
  return {
    /** Keeps `url` under `title` where a new bookmark goes (`newBookmarkPlace`), and returns the bookmark. */
    bookmark: ({ title, url }: { title: string; url: string }): Bookmark => {
      const kept = bookmarkOf(url);
      if (kept) {
        return kept;
      }
      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        ...newBookmarkPlace(state, lastFolder),
        title,
        url,
      };
      void applyBookmarkOps([{ bookmark, type: "add" }]);
      return bookmark;
    },
    /** The bookmark kept for an address, if there is one. */
    bookmarkOf,
    /** Every bookmark, in order. */
    bookmarks,
    isBookmarked: (url: string) => bookmarkOf(url) !== undefined,
    remove: (bookmark: Bookmark) => {
      void applyBookmarkOps([{ id: bookmark.id, type: "remove" }]);
    },
    /** Renames a bookmark; a name left empty is kept empty, as Chrome keeps it. */
    rename: (bookmark: Bookmark, title: string) => {
      const named = title.trim();
      if (named === bookmark.title) {
        return;
      }
      void applyBookmarkOps([
        { id: bookmark.id, title: named, type: "rename" },
      ]);
    },
  };
}

/**
 * Keeps an address the way every add that picks no place does, a row's
 * menu or the agent: last in its kind's folder of Other bookmarks
 * (`sortedKindOf`, `sortedAddOps`), made where it is gone. An address kept
 * already stays where it is, and that bookmark is answered.
 */
export function addSortedBookmark(
  store: ReturnType<typeof useStore>,
  { title, url }: { title: string; url: string },
): { bookmark: Bookmark; isNew: boolean } {
  const state = store.get(bookmarksStateAtom);
  const kept = state.bookmarks.find((bookmark) =>
    sameAddress(bookmark.url, url),
  );
  if (kept) {
    return { bookmark: kept, isNew: false };
  }
  const id = crypto.randomUUID();
  const ops = sortedAddOps(state, { id, title, url }, sortedKindOf(url));
  void store.set(applyBookmarkOpsAtom, ops);
  const [added] = ops.flatMap((op) => (op.type === "add" ? [op.bookmark] : []));
  if (!added) {
    throw new Error("The bookmark was not added");
  }
  return { bookmark: added, isNew: true };
}

/**
 * Keeping an address from a menu over a link, a file or a tab, for a
 * surface that draws many: the bookmarks are read at the press rather than
 * followed, so a change to them redraws none of the links. An address not
 * kept yet goes into Other bookmarks (`addSortedBookmark`), and one kept
 * already stays where it is; the toast says which.
 */
export function useAddBookmark() {
  const store = useStore();
  return ({ title, url }: { title: string; url: string }) => {
    const { bookmark, isNew } = addSortedBookmark(store, { title, url });
    if (!isNew) {
      toast("Already in Bookmarks", { description: bookmark.title || url });
      return;
    }
    toast(`Added to ${OTHER_ROOT_TITLE}`, { description: title || url });
  };
}
