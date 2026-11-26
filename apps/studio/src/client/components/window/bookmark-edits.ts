import { UNDO_LABEL } from "@/client/lib/undo-toast";
import { applyBookmarkOpsAtom } from "@/client/bookmarks/store";
import { type Bookmark } from "@/shared/bookmarks";
import { toast } from "@/client/lib/toast";
import { useSetAtom } from "jotai";

/** What a bookmark is called where it is shown: its own title, or its site's. */
export function bookmarkName(bookmark: Bookmark): string {
  return bookmark.title || hostOf(bookmark.url);
}

/**
 * Renaming a bookmark and removing one, wherever bookmarks are shown: a
 * name left empty is kept empty, as Chrome keeps it, and a removal says so
 * with a way to undo it.
 */
export function useBookmarkEdits() {
  const applyBookmarkOps = useSetAtom(applyBookmarkOpsAtom);
  return {
    remove: (bookmark: Bookmark) => {
      void applyBookmarkOps([{ id: bookmark.id, type: "remove" }]);
      toast("Removed from Bookmarks", {
        action: {
          label: UNDO_LABEL,
          // Back where it was, by the order it had.
          onClick: () => {
            void applyBookmarkOps([{ bookmark, type: "add" }]);
          },
        },
        description: bookmarkName(bookmark),
      });
    },
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

/** The site a page is on, as its bar would name it. */
export function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}
