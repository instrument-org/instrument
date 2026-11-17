import { omit } from "radashi";

/**
 * The bookmarks every window shows, and the one way they change.
 *
 * The main process owns them (`electron-main/bookmarks/`): they are a synced
 * store every device of the workspace writes its own file of, and main takes
 * in what another device writes. A window changes them by sending a
 * {@link BookmarkOp} and shows them as main last said they were, with the
 * ops it has sent since applied over them, so its own changes show at once
 * and a change from elsewhere never undoes one still on its way. Both sides
 * apply ops with {@link applyBookmarkOps}, which is what makes the two agree.
 */

/**
 * The other root bookmarks are kept under beside the bar, as Chrome has it:
 * All Bookmarks, which the bar shows as one chip at its right end, and
 * where every add that picks no place goes. A bookmark or folder without a
 * root is the bar's.
 */
export const OTHER_ROOT = "other";

export type BookmarkRoot = typeof OTHER_ROOT;

/** What the other root is called wherever it is listed. */
export const OTHER_ROOT_TITLE = "All Bookmarks";

/**
 * An address the person kept: a website's, a file's or a folder's
 * (`file://<path>`, or the `instrument://file/<path>` an earlier build
 * kept), or the app's own for a chat or a built-in page
 * (`instrument://chat/<id>`, `instrument://screen/<name>`).
 */
export interface Bookmark {
  /**
   * The folder it is filed in, by id. Without one, or where the folder it
   * names is not there (`folderOf`), it is loose in its root.
   */
  folder?: string;
  id: string;
  /** Where it sorts among the others beside it, in its root or in its folder; any number, smaller first. */
  order: number;
  /**
   * The root it is loose in, where it is in no folder: All Bookmarks, or
   * the bar without one. Filed in a folder, it is in the folder's root.
   */
  root?: BookmarkRoot;
  title: string;
  url: string;
}

/**
 * A folder of a root, which opens as a menu of the bookmarks filed in it.
 * Folders are one level deep: a folder is never in another, so no chain of
 * folders can loop, and it stays in the root it was made in.
 */
export interface BookmarkFolder {
  id: string;
  /** Where it sorts among the bookmarks and folders of its root. */
  order: number;
  /** All Bookmarks, or the bar without one. */
  root?: BookmarkRoot;
  title: string;
}

/** Where something is kept: in a folder, or loose in a root, the bar without either. */
export interface BookmarkPlace {
  folder?: string;
  root?: BookmarkRoot;
}

/** Every bookmark, and the folders some are filed in. */
export interface Bookmarks {
  /** Every bookmark, on the bar or in a folder, in order. */
  bookmarks: Bookmark[];
  /** Every folder, in order. */
  folders: BookmarkFolder[];
}

/** One change to the bookmarks, carrying everything it needs so main and every window apply it alike. */
export type BookmarkOp =
  /** Kept, with an id and an order the window chose. Ignored where the id is taken. */
  | { bookmark: Bookmark; type: "add" }
  /** A folder made on the bar. Ignored where the id is taken. */
  | { folder: BookmarkFolder; type: "addFolder" }
  /**
   * A bookmark or a folder moved to sort at `order`: a bookmark into
   * `folder`, or loose into `root` (the bar without one). A folder stays in
   * its root.
   */
  | {
      folder?: string;
      id: string;
      order: number;
      root?: BookmarkRoot;
      type: "move";
    }
  /** No longer kept; a folder goes with every bookmark filed in it. */
  | { id: string; type: "remove" }
  /** A bookmark or a folder under a new name. */
  | { id: string; title: string; type: "rename" }
  /**
   * A bookmark kept at another address. A folder has none, so one is left
   * as it is, and so is a bookmark given no address at all.
   */
  | { id: string; type: "setUrl"; url: string };

/** Main's bookmarks as a window receives them, with the last batch it applied from each window. */
export interface BookmarksSnapshot extends Bookmarks {
  /** By window: the `seq` of the last batch main applied from it. */
  acks: Record<string, number>;
}

/** A batch of ops from one window, numbered so main can say which it has applied. */
export interface BookmarkOpBatch {
  /** The window sending, by the id it made for itself as it loaded. */
  client: string;
  ops: BookmarkOp[];
  /** Counts up per window; the batch is applied once an ack reaches it. */
  seq: number;
}

/**
 * The IPC channels between a window and main's bookmarks: `load` is the
 * preload's synchronous read as the window loads, `apply` a batch of ops, and
 * `changed` main telling every window what the bookmarks are now.
 */
export const BOOKMARKS_CHANNEL = {
  apply: "bookmarks:apply",
  changed: "bookmarks:changed",
  load: "bookmarks:load",
} as const;

/** A window's side of main's bookmarks, as the preload hands it over. */
export interface BookmarksBridge {
  /** Sends a batch, answered once main has applied it and written it through. */
  apply: (batch: BookmarkOpBatch) => Promise<void>;
  /** The bookmarks as the window loaded. */
  initial: BookmarksSnapshot;
  /** Every change main makes, from any window or another device; returns the stop. */
  onChange: (listener: (snapshot: BookmarksSnapshot) => void) => () => void;
}

/** Applies ops in order, answering the bookmarks and the folders in order. */
export function applyBookmarkOps(
  state: Bookmarks,
  ops: readonly BookmarkOp[],
): Bookmarks {
  const next = ops.reduce(applyBookmarkOp, {
    bookmarks: [...state.bookmarks],
    folders: [...state.folders],
  });
  return { bookmarks: inOrder(next.bookmarks), folders: inOrder(next.folders) };
}

function applyBookmarkOp(state: Bookmarks, op: BookmarkOp): Bookmarks {
  const { bookmarks, folders } = state;
  const isTaken = (id: string) =>
    bookmarks.some((each) => each.id === id) ||
    folders.some((each) => each.id === id);
  // Filed in a folder that is not there is loose in the root it names.
  const placed = ({ folder, root }: BookmarkPlace) =>
    folder !== undefined && folders.some((each) => each.id === folder)
      ? { folder }
      : rootField(root);
  switch (op.type) {
    case "add": {
      if (isTaken(op.bookmark.id)) {
        return state;
      }
      return {
        bookmarks: [
          ...bookmarks,
          { ...omit(op.bookmark, ["folder", "root"]), ...placed(op.bookmark) },
        ],
        folders,
      };
    }
    case "addFolder": {
      const { id, order, root, title } = op.folder;
      return isTaken(id)
        ? state
        : {
            bookmarks,
            folders: [...folders, { id, order, title, ...rootField(root) }],
          };
    }
    case "move": {
      return {
        bookmarks: bookmarks.map((bookmark) =>
          bookmark.id === op.id
            ? {
                ...omit(bookmark, ["folder", "root"]),
                order: op.order,
                ...placed(op),
              }
            : bookmark,
        ),
        folders: folders.map((folder) =>
          folder.id === op.id ? { ...folder, order: op.order } : folder,
        ),
      };
    }
    case "remove": {
      return {
        bookmarks: bookmarks.filter(
          (bookmark) => bookmark.id !== op.id && bookmark.folder !== op.id,
        ),
        folders: folders.filter((folder) => folder.id !== op.id),
      };
    }
    case "rename": {
      return {
        bookmarks: bookmarks.map((bookmark) =>
          bookmark.id === op.id ? { ...bookmark, title: op.title } : bookmark,
        ),
        folders: folders.map((folder) =>
          folder.id === op.id ? { ...folder, title: op.title } : folder,
        ),
      };
    }
    case "setUrl": {
      if (op.url === "") {
        return state;
      }
      return {
        bookmarks: bookmarks.map((bookmark) =>
          bookmark.id === op.id ? { ...bookmark, url: op.url } : bookmark,
        ),
        folders,
      };
    }
  }
}

/** A root as a member keeps it: only All Bookmarks is written, the bar being none. */
function rootField(root: BookmarkRoot | undefined): { root?: BookmarkRoot } {
  return root === OTHER_ROOT ? { root } : {};
}

/** Sorted by order, ties by id, so every window and device lists them alike. */
export function inOrder<T extends { id: string; order: number }>(
  items: readonly T[],
): T[] {
  return items.toSorted((a, b) =>
    a.order === b.order
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.order - b.order,
  );
}

/** Where an item added now sorts among `items`: after every one there is. */
export function orderAfter(items: readonly { order: number }[]): number {
  return items.reduce((last, item) => Math.max(last, item.order + 1), 0);
}

/** The orders that sort some bookmarks, in turn, at a place among others, evenly between its neighbors. */
export function ordersAt(
  there: readonly { order: number }[],
  index: number,
  count: number,
  all: readonly { order: number }[],
): number[] {
  const before = there[index - 1];
  const after = there[index];
  const from = before
    ? before.order
    : after
      ? after.order - count
      : orderAfter(all) - 1;
  const to = after ? after.order : from + count + 1;
  const step = (to - from) / (count + 1);
  return Array.from({ length: count }, (_, at) => from + step * (at + 1));
}

/**
 * The folder a bookmark is filed in, where it is there. A bookmark naming a
 * folder another device removed, or one not read yet, is loose in its root.
 */
export function folderOf(
  { folders }: Pick<Bookmarks, "folders">,
  bookmark: Bookmark,
): BookmarkFolder | undefined {
  return bookmark.folder === undefined
    ? undefined
    : folders.find((folder) => folder.id === bookmark.folder);
}

/** Where a bookmark is: in its folder where that is there, loose in its root otherwise. */
export function placeOf(state: Bookmarks, bookmark: Bookmark): BookmarkPlace {
  const folder = folderOf(state, bookmark);
  return folder ? { folder: folder.id } : rootField(bookmark.root);
}

/** The root a bookmark is in: its folder's, or its own where it is loose. */
export function rootOf(
  state: Bookmarks,
  bookmark: Bookmark,
): BookmarkRoot | undefined {
  const folder = folderOf(state, bookmark);
  return folder ? folder.root : bookmark.root;
}

/** What a root shows: a bookmark loose in it, or a folder with the bookmarks filed in it. */
export type BarItem =
  | { bookmark: Bookmark; kind: "bookmark" }
  | { folder: BookmarkFolder; items: Bookmark[]; kind: "folder" };

/** The bookmark or folder a root's item is. */
function memberOf(item: BarItem): Bookmark | BookmarkFolder {
  return item.kind === "folder" ? item.folder : item.bookmark;
}

/**
 * A root's items, its loose bookmarks and its folders sorted together by
 * order: the bar's without a root. Every bookmark is in exactly one place:
 * in its folder where that is there, loose in its root otherwise.
 */
export function rootItems(
  state: Bookmarks,
  root: BookmarkRoot | undefined,
): BarItem[] {
  const contents = new Map<string, Bookmark[]>(
    state.folders.map((folder) => [folder.id, []]),
  );
  const loose: BarItem[] = [];
  for (const bookmark of inOrder(state.bookmarks)) {
    const items =
      bookmark.folder === undefined ? undefined : contents.get(bookmark.folder);
    if (items) {
      items.push(bookmark);
    } else if (bookmark.root === root) {
      loose.push({ bookmark, kind: "bookmark" });
    }
  }
  const folders: BarItem[] = state.folders
    .filter((folder) => folder.root === root)
    .map((folder) => ({
      folder,
      items: contents.get(folder.id) ?? [],
      kind: "folder",
    }));
  const keyed = [...loose, ...folders].map((item) => ({
    ...memberOf(item),
    item,
  }));
  return inOrder(keyed).map(({ item }) => item);
}

/** The bar's items, bookmarks and folders sorted together by order. */
export function barItems(state: Bookmarks): BarItem[] {
  return rootItems(state, undefined);
}

/** Where a bookmark or folder added to the bar now sorts: after everything on it. */
export function orderOnBar(state: Bookmarks): number {
  return orderAfter(siblingsIn(state, undefined));
}

/** Every bookmark of the bar in the order it shows them, each folder's in its place among them. */
export function inBarOrder(state: Bookmarks): Bookmark[] {
  return barItems(state).flatMap((item) =>
    item.kind === "folder" ? item.items : [item.bookmark],
  );
}

/**
 * What sits in `folder`, or loose in `root` with no folder (the bar without
 * either), in order, as the ids and orders a place among them is found by.
 */
export function siblingsIn(
  state: Bookmarks,
  folder: string | undefined,
  root?: BookmarkRoot,
): { id: string; order: number }[] {
  if (folder === undefined) {
    return rootItems(state, root).map(memberOf);
  }
  return inOrder(
    state.bookmarks.filter(
      (bookmark) => folderOf(state, bookmark)?.id === folder,
    ),
  );
}

/**
 * The places a bookmark can be kept, in the order a list of them shows:
 * the bar, its folders, All Bookmarks, and its folders. Each by its key
 * (`placeOfKey`), with its depth under its root.
 */
export function bookmarkPlaces(
  state: Bookmarks,
): { depth: 0 | 1; key: string | undefined; title: string }[] {
  const foldersOf = (root: BookmarkRoot | undefined) =>
    inOrder(state.folders.filter((folder) => folder.root === root)).map(
      (folder) => ({ depth: 1 as const, key: folder.id, title: folder.title }),
    );
  return [
    { depth: 0, key: undefined, title: "Bookmarks bar" },
    ...foldersOf(undefined),
    { depth: 0, key: OTHER_ROOT, title: OTHER_ROOT_TITLE },
    ...foldersOf(OTHER_ROOT),
  ];
}

/**
 * A place as one string, for a list to pick it by and for the last folder
 * picked to be kept as: a folder by its id, All Bookmarks by
 * `OTHER_ROOT`, and the bar as none. No folder's id is `OTHER_ROOT`.
 */
export function placeOfKey(key: string | undefined): BookmarkPlace {
  return key === undefined
    ? {}
    : key === OTHER_ROOT
      ? { root: OTHER_ROOT }
      : { folder: key };
}

/** The key of a place (`placeOfKey`). */
export function keyOfPlace({
  folder,
  root,
}: BookmarkPlace): string | undefined {
  return folder ?? root;
}
