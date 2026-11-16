import { toast } from "@/client/lib/toast";
import {
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  orderAfter,
  orderOnBar,
  siblingsIn,
} from "@/shared/bookmarks";
import { useSetAtom, useStore } from "jotai";

import { applyBookmarkOpsAtom, bookmarksStateAtom } from "./store";

/**
 * Making, renaming and removing the bookmarks bar's folders, and filing a
 * bookmark in one or taking it back out onto the bar. The bookmarks are
 * read at the press, so nothing redraws for them.
 */
export function useBookmarkFolders() {
  const store = useStore();
  const apply = useSetAtom(applyBookmarkOpsAtom);
  return {
    /**
     * Makes a folder on the bar under `title`, right after the item `after`
     * names, or last; answers it. An empty name makes none.
     */
    create: (title: string, after?: string): BookmarkFolder | undefined => {
      const named = title.trim();
      if (!named) {
        return undefined;
      }
      const state = store.get(bookmarksStateAtom);
      const onBar = siblingsIn(state, undefined);
      const at = onBar.findIndex((each) => each.id === after);
      const before = onBar[at];
      const next = onBar[at + 1];
      const folder: BookmarkFolder = {
        id: crypto.randomUUID(),
        order:
          before === undefined
            ? orderOnBar(state)
            : next === undefined
              ? before.order + 1
              : (before.order + next.order) / 2,
        title: named,
      };
      void apply([{ folder, type: "addFolder" }]);
      return folder;
    },
    /** Files a bookmark last in `folder`, or puts it last on the bar without one. */
    moveTo: (bookmark: Bookmark, folder: string | undefined) => {
      if (bookmark.folder === folder) {
        return;
      }
      const state = store.get(bookmarksStateAtom);
      const order =
        folder === undefined
          ? orderOnBar(state)
          : orderAfter(siblingsIn(state, folder));
      void apply([
        {
          id: bookmark.id,
          order,
          type: "move",
          ...(folder === undefined ? {} : { folder }),
        },
      ]);
    },
    /**
     * Removes a folder with every bookmark in it, as a browser does, with
     * Undo in a toast that puts the folder and each of them back as they
     * were.
     */
    remove: (folder: BookmarkFolder) => {
      const inside = store
        .get(bookmarksStateAtom)
        .bookmarks.filter((bookmark) => bookmark.folder === folder.id);
      void apply([{ id: folder.id, type: "remove" }]);
      toast(`Deleted “${folder.title}”`, {
        action: {
          label: "Undo",
          onClick: () => {
            void apply([
              { folder, type: "addFolder" },
              ...inside.map(
                (bookmark): BookmarkOp => ({
                  bookmark,
                  type: "add",
                }),
              ),
            ]);
          },
        },
        ...(inside.length > 0
          ? {
              description:
                inside.length === 1
                  ? "The bookmark in it was deleted too."
                  : `The ${inside.length.toString()} bookmarks in it were deleted too.`,
            }
          : {}),
      });
    },
    /** Renames a folder; a name left empty or unchanged keeps the old one. */
    rename: (folder: BookmarkFolder, title: string) => {
      const named = title.trim();
      if (!named || named === folder.title) {
        return;
      }
      void apply([{ id: folder.id, title: named, type: "rename" }]);
    },
  };
}
