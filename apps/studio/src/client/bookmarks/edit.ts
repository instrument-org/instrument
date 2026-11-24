import { typedAddress } from "@/client/lib/typed-address";
import {
  applyBookmarkOps,
  type Bookmark,
  type BookmarkFolder,
  type BookmarkOp,
  type BookmarkPlace,
  type Bookmarks,
  keyOfPlace,
  orderAfter,
  placeOf,
  placeOfKey,
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
  const address = typedAddress(words);
  return address?.kind === "page" ? address.url : undefined;
}

/** What the editor's Save changes: the name, the address, the place, and the folders made in it. */
export interface BookmarkEdit {
  /** The place picked, by its key (`placeOfKey`): a folder, a new one's included, All Bookmarks, or the bar without one. */
  folder: string | undefined;
  /** Folders New folder made in the editor, kept only as it saves. */
  newFolders: readonly BookmarkFolder[];
  title: string;
  url: string;
}

/**
 * The ops that make an edit so, as one batch: the new folders on the bar's
 * end, then the bookmark added (where `bookmark` is a new one, not kept
 * yet) or renamed, readdressed and moved to the end of the place picked.
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
  const place = placeOfKey(edit.folder);
  const end = orderAfter(
    siblingsIn(withFolders, place.folder, place.root).filter(
      (each) => each.id !== bookmark.id,
    ),
  );
  if (!kept) {
    return [
      ...folderOps,
      {
        bookmark: {
          id: bookmark.id,
          order: end,
          title,
          url: edit.url,
          ...place,
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
  if (edit.folder !== keyOfPlace(placeOf(state, kept))) {
    ops.push({ id: kept.id, order: end, type: "move", ...place });
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
 * Where the address bar's star keeps a bookmark made now: last in the place
 * picked last (`lastBookmarkFolderAtom`, by its key) while that is there,
 * and last on the bar otherwise.
 */
export function newBookmarkPlace(
  state: Bookmarks,
  lastFolder: string | null,
): BookmarkPlace & { order: number } {
  const picked = placeOfKey(lastFolder ?? undefined);
  const place =
    picked.root !== undefined ||
    state.folders.some((each) => each.id === picked.folder)
      ? picked
      : {};
  return {
    order: orderAfter(siblingsIn(state, place.folder, place.root)),
    ...place,
  };
}
