import { siteFromWords } from "@/client/lib/site-from-words";
import {
  applyBookmarkOps,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type Bookmarks,
  folderOf,
  orderAfter,
  siblingsIn,
} from "@/shared/bookmarks";

/**
 * The address typed into a bookmark's editor as the bookmark keeps it: one
 * with a scheme as written, and a bare host the way the address field reads
 * it (`example.com/docs` is `https://example.com/docs`). Nothing for words
 * that are no address, which the editor will not save.
 */
export function addressOfTyped(typed: string): string | undefined {
  const words = typed.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(words) && URL.canParse(words)) {
    return words;
  }
  return siteFromWords(words)?.url;
}

/** What the editor's Save changes: the name, the address, the folder, and the folders made in it. */
export interface BookmarkEdit {
  /** The folder picked, by id, a new one's included; none for the bar. */
  folder: string | undefined;
  /** Folders New folder made in the editor, kept only as it saves. */
  newFolders: readonly BookmarkFolder[];
  title: string;
  url: string;
}

/**
 * The ops that make an edit so, as one batch: the new folders on the bar's
 * end, then the bookmark added (where `bookmark` is a new one, not kept
 * yet) or renamed, readdressed and moved to the end of the folder picked.
 * Only what changed has an op.
 */
export function bookmarkEditOps(
  state: Bookmarks,
  bookmark: Bookmark,
  edit: BookmarkEdit,
): BookmarkOp[] {
  const folderOps = newFolderOps(state, edit.newFolders);
  const withFolders = applyBookmarkOps(state, folderOps);
  const title = edit.title.trim();
  const kept = state.bookmarks.find((each) => each.id === bookmark.id);
  const endOf = (folder: string | undefined) =>
    orderAfter(
      siblingsIn(withFolders, folder).filter((each) => each.id !== bookmark.id),
    );
  if (!kept) {
    return [
      ...folderOps,
      {
        bookmark: {
          id: bookmark.id,
          order: endOf(edit.folder),
          title,
          url: edit.url,
          ...(edit.folder === undefined ? {} : { folder: edit.folder }),
        },
        type: "add",
      },
    ];
  }
  const ops: BookmarkOp[] = [...folderOps];
  if (title !== kept.title) {
    ops.push({ id: kept.id, title, type: "rename" });
  }
  if (edit.url !== kept.url && edit.url !== "") {
    ops.push({ id: kept.id, type: "setUrl", url: edit.url });
  }
  if (edit.folder !== folderOf(state, kept)?.id) {
    ops.push({
      id: kept.id,
      order: endOf(edit.folder),
      type: "move",
      ...(edit.folder === undefined ? {} : { folder: edit.folder }),
    });
  }
  return ops;
}

/** Folders made in the editor, each after the last on the bar, an empty name made "New folder". */
function newFolderOps(
  state: Bookmarks,
  folders: readonly BookmarkFolder[],
): BookmarkOp[] {
  let order = orderAfter(siblingsIn(state, undefined));
  return folders.map((folder) => ({
    folder: {
      id: folder.id,
      order: order++,
      title: folder.title.trim() || NEW_FOLDER_NAME,
    },
    type: "addFolder",
  }));
}

/** What a folder is called until it is named, as a browser names one. */
export const NEW_FOLDER_NAME = "New folder";

/**
 * Where a bookmark made now goes: last in the folder picked last
 * (`lastBookmarkFolderAtom`) while that is there, and last on the bar
 * otherwise.
 */
export function newBookmarkPlace(
  state: Bookmarks,
  lastFolder: string | null,
): { folder?: string; order: number } {
  const folder = state.folders.some((each) => each.id === lastFolder)
    ? (lastFolder ?? undefined)
    : undefined;
  return {
    order: orderAfter(siblingsIn(state, folder)),
    ...(folder === undefined ? {} : { folder }),
  };
}
