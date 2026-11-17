import { useBookmarkFolders } from "@/client/bookmarks/folders";
import {
  applyBookmarkOpsAtom,
  lastBookmarkFolderAtom,
} from "@/client/bookmarks/store";
import { NEW_FOLDER_NAME } from "@/client/bookmarks/edit";
import { type BookmarkOp } from "@/shared/bookmarks";
import { atom, getDefaultStore, useAtom, useSetAtom } from "jotai";

import { BookmarkNameDialog } from "./bookmark-folders";

/** Whether Bookmark All Tabs is asking for its folder's name. */
const askingAtom = atom(false);

/** Bookmark All Tabs…, from the window's chord or a menu: the dialog asks for the folder's name. */
export function requestBookmarkAllTabs() {
  getDefaultStore().set(askingAtom, true);
}

/**
 * Bookmark All Tabs, as a browser has it: every tab of the group on screen
 * that has an address, in order, into a new folder on the bar, named in a
 * dialog that starts at "New folder". The tabs are read as it saves.
 */
export function BookmarkAllTabs({
  pages,
}: {
  /** The tabs of the group on screen as bookmarks would keep them. */
  pages: () => { title: string; url: string }[];
}) {
  const [isAsking, setAsking] = useAtom(askingAtom);
  const folders = useBookmarkFolders();
  const apply = useSetAtom(applyBookmarkOpsAtom);
  const setLastFolder = useSetAtom(lastBookmarkFolderAtom);
  if (!isAsking) {
    return null;
  }
  return (
    <BookmarkNameDialog
      action="Save"
      name={NEW_FOLDER_NAME}
      onClose={() => {
        setAsking(false);
      }}
      onCommit={(title) => {
        const folder = folders.create(title);
        if (!folder) {
          return;
        }
        setLastFolder(folder.id);
        void apply(
          pages().map(
            (page, order): BookmarkOp => ({
              bookmark: {
                folder: folder.id,
                id: crypto.randomUUID(),
                order,
                ...page,
              },
              type: "add",
            }),
          ),
        );
      }}
      title="Bookmark all tabs"
    />
  );
}
