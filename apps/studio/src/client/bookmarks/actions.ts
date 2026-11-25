import {
  type Bookmark,
  type BookmarkRoot,
  type Bookmarks,
  folderOf,
  orderAfter,
  OTHER_ROOT,
  OTHER_ROOT_TITLE,
  rootItems,
  rootOf,
  siblingsIn,
} from "@/shared/bookmarks";
import { toast } from "@/client/lib/toast";
import { type WindowTabAnswer } from "@instrument-org/workspace/client";
import { useAtomValue, useSetAtom, useStore } from "jotai";

import { sameAddress } from "./address";
import {
  agentChangeOps,
  bookmarkChangesBetween,
  listedRoot,
} from "./agent-changes";
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
 * menu or the agent: loose and last in All Bookmarks, as Chrome files
 * them. An address kept already stays where it is, and that bookmark is
 * answered.
 */
export function addToAllBookmarks(
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
  const bookmark: Bookmark = {
    id: crypto.randomUUID(),
    order: orderAfter(siblingsIn(state, undefined, OTHER_ROOT)),
    root: OTHER_ROOT,
    title,
    url,
  };
  void store.set(applyBookmarkOpsAtom, [{ bookmark, type: "add" }]);
  return { bookmark, isNew: true };
}

/**
 * Keeping an address from a menu over a link, a file or a tab, for a
 * surface that draws many: the bookmarks are read at the press rather than
 * followed, so a change to them redraws none of the links. An address not
 * kept yet goes into All Bookmarks (`addToAllBookmarks`), and one kept
 * already stays where it is; the toast says which.
 */
export function useAddBookmark() {
  const store = useStore();
  return ({ title, url }: { title: string; url: string }) => {
    const { bookmark, isNew } = addToAllBookmarks(store, { title, url });
    if (!isNew) {
      toast("Already in Bookmarks", { description: bookmark.title || url });
      return;
    }
    toast(`Added to ${OTHER_ROOT_TITLE}`, { description: title || url });
  };
}

/** Makes a change the agent asked for, and answers what it did. */
export function changeBookmarks(
  store: ReturnType<typeof useStore>,
  change: Parameters<typeof agentChangeOps>[1],
): Pick<WindowTabAnswer, "bookmarkChanges" | "error"> {
  const before = store.get(bookmarksStateAtom);
  const made = agentChangeOps(before, change);
  if ("error" in made) {
    return { error: made.error };
  }
  if (made.ops.length > 0) {
    void store.set(applyBookmarkOpsAtom, made.ops);
  }
  return {
    bookmarkChanges: bookmarkChangesBetween(
      before,
      store.get(bookmarksStateAtom),
    ),
  };
}

type ListedBookmark = NonNullable<WindowTabAnswer["bookmarks"]>[number];

/** A bookmark as `instrument bookmarks` tells the agent of it: where it is, its name and its address. */
export function listedBookmark(
  state: Bookmarks,
  bookmark: Bookmark,
): ListedBookmark {
  const folder = folderOf(state, bookmark);
  return {
    id: bookmark.id,
    kind: "bookmark",
    root: listedRoot(rootOf(state, bookmark)),
    title: bookmark.title,
    url: bookmark.url,
    ...(folder ? { folder: folder.title } : {}),
  };
}

/**
 * Every folder and bookmark as `instrument bookmarks list` reads them, in the
 * Bookmarks page's order: the bar's, then All Bookmarks', each folder
 * before what is filed in it.
 */
export function bookmarkListing(state: Bookmarks): ListedBookmark[] {
  const roots: (BookmarkRoot | undefined)[] = [undefined, OTHER_ROOT];
  return roots.flatMap((root) =>
    rootItems(state, root).flatMap((item): ListedBookmark[] =>
      item.kind === "bookmark"
        ? [listedBookmark(state, item.bookmark)]
        : [
            {
              id: item.folder.id,
              kind: "folder",
              root: listedRoot(root),
              title: item.folder.title,
            },
            ...item.items.map((bookmark) => listedBookmark(state, bookmark)),
          ],
    ),
  );
}
