import { type AckedSnapshot, type OpBatch } from "./op-batch";
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
 * A folder, loose in a root or in another folder, which opens as a menu of
 * the bookmarks and folders in it. A move never puts a folder in itself or
 * one inside it, but two devices each moving one of two folders into the
 * other can, and a folder whose chain of parents comes back to it is loose
 * in the bar (`parentOf`).
 */
export interface BookmarkFolder {
  /**
   * The folder it is in, by id. Without one, or where the folder it names is
   * not there, it is loose in its root.
   */
  folder?: string;
  id: string;
  /** Where it sorts among the bookmarks and folders beside it. */
  order: number;
  /**
   * All Bookmarks, or the bar without one. In a folder it is the root that
   * folder was in when this one was put there, which only a build that
   * reads no `folder` on a folder goes by: the root it shows is its top
   * folder's.
   */
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
  /** A folder made in its root or in its folder. Ignored where the id is taken. */
  | { folder: BookmarkFolder; type: "addFolder" }
  /**
   * A bookmark or a folder moved to sort at `order`: into `folder`, or loose
   * into `root` (the bar without one). A folder moved into itself or one
   * inside it stays where it is.
   */
  | {
      folder?: string;
      id: string;
      order: number;
      root?: BookmarkRoot;
      type: "move";
    }
  /** No longer kept; a folder goes with everything in it. */
  | { id: string; type: "remove" }
  /** A bookmark or a folder under a new name. */
  | { id: string; title: string; type: "rename" }
  /**
   * A bookmark kept at another address. A folder has none, so one is left
   * as it is, and so is a bookmark given no address at all.
   */
  | { id: string; type: "setUrl"; url: string };

/** Main's bookmarks as a window receives them, with the last batch it applied from each window. */
export interface BookmarksSnapshot extends Bookmarks, AckedSnapshot {
  /**
   * Set while main has not yet read the bookmarks, when `bookmarks` and
   * `folders` say nothing of what is kept: before the workspace opens, and
   * while its first read is under way.
   */
  loading?: true;
}

/** A batch of bookmark ops from one window (`OpBatch`). */
export type BookmarkOpBatch = OpBatch<BookmarkOp>;

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
  // A folder in a folder also names the root it is in, for a build that
  // reads no folder's `folder`.
  const placedFolder = (place: BookmarkPlace) => {
    const at = placed(place);
    return "folder" in at
      ? { ...at, ...rootField(folderRootOf(state, at.folder)) }
      : at;
  };
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
      const { id, order, title } = op.folder;
      return isTaken(id)
        ? state
        : {
            bookmarks,
            folders: [
              ...folders,
              { id, order, title, ...placedFolder(op.folder) },
            ],
          };
    }
    case "move": {
      if (op.folder !== undefined && isWithin(state, op.folder, op.id)) {
        return state;
      }
      const moved: Bookmarks = {
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
          folder.id === op.id
            ? {
                ...omit(folder, ["folder", "root"]),
                order: op.order,
                ...placedFolder(op),
              }
            : folder,
        ),
      };
      // The folders inside a folder moved name the root it is in now.
      return {
        bookmarks: moved.bookmarks,
        folders: moved.folders.map((folder) =>
          folder.id !== op.id &&
          folder.folder !== undefined &&
          isWithin(moved, folder.id, op.id)
            ? {
                ...omit(folder, ["root"]),
                ...rootField(folderRootOf(moved, folder.id)),
              }
            : folder,
        ),
      };
    }
    case "remove": {
      const gone = new Set(
        folders
          .filter((folder) => isWithin(state, folder.id, op.id))
          .map((folder) => folder.id),
      );
      return {
        bookmarks: bookmarks.filter(
          (bookmark) =>
            bookmark.id !== op.id && !gone.has(bookmark.folder ?? ""),
        ),
        folders: folders.filter((folder) => !gone.has(folder.id)),
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

/** Where a folder is: in the folder it is in, or loose in its root. */
export function placeOfFolder(
  state: Pick<Bookmarks, "folders">,
  folder: BookmarkFolder,
): BookmarkPlace {
  const parent = parentOf(state, folder);
  return parent
    ? { folder: parent.id }
    : rootField(folderRootOf(state, folder.id));
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
  return folder ? folderRootOf(state, folder.id) : bookmark.root;
}

/**
 * The folder a folder is in, where that is there and its chain of parents
 * never comes back to it. One in a loop, which only two devices' moves
 * crossing can make, is loose in the bar, as every folder of the loop is.
 */
export function parentOf(
  { folders }: Pick<Bookmarks, "folders">,
  folder: BookmarkFolder,
): BookmarkFolder | undefined {
  const byId = new Map(folders.map((each) => [each.id, each]));
  const parent =
    folder.folder === undefined ? undefined : byId.get(folder.folder);
  const seen = new Set([folder.id]);
  for (let at = parent; at;) {
    if (seen.has(at.id)) {
      return undefined;
    }
    seen.add(at.id);
    at = at.folder === undefined ? undefined : byId.get(at.folder);
  }
  return parent;
}

/**
 * The root a folder shows in: its top folder's, its own where the folder it
 * names is gone, and the bar where its chain of parents loops.
 */
export function folderRootOf(
  state: Pick<Bookmarks, "folders">,
  id: string,
): BookmarkRoot | undefined {
  let folder = state.folders.find((each) => each.id === id);
  if (!folder) {
    return undefined;
  }
  const named = folder.folder;
  if (
    named !== undefined &&
    state.folders.some((each) => each.id === named) &&
    !parentOf(state, folder)
  ) {
    return undefined;
  }
  for (let parent = parentOf(state, folder); parent;) {
    folder = parent;
    parent = parentOf(state, parent);
  }
  return folder.root;
}

/** Whether `id` is the folder `ancestor` or a folder somewhere inside it. */
export function isWithin(
  state: Pick<Bookmarks, "folders">,
  id: string,
  ancestor: string,
): boolean {
  let folder = state.folders.find((each) => each.id === id);
  for (const seen = new Set<string>(); folder && !seen.has(folder.id);) {
    if (folder.id === ancestor) {
      return true;
    }
    seen.add(folder.id);
    folder = parentOf(state, folder);
  }
  return false;
}

/** What a root or a folder shows: a bookmark, or a folder with what is in it. */
export type BarItem =
  | { bookmark: Bookmark; kind: "bookmark" }
  | { folder: BookmarkFolder; items: BarItem[]; kind: "folder" };

/** The bookmarks among a folder's items, and none in a folder inside it, as Open All opens them. */
export function bookmarksDirectlyIn(items: readonly BarItem[]): Bookmark[] {
  return items.flatMap((item) =>
    item.kind === "bookmark" ? [item.bookmark] : [],
  );
}

/** Every bookmark in a folder's items, the folders' in them included, in the order a menu shows them. */
export function bookmarksIn(items: readonly BarItem[]): Bookmark[] {
  return items.flatMap((item) =>
    item.kind === "folder" ? bookmarksIn(item.items) : [item.bookmark],
  );
}

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
  // What is in each folder by its id, and loose in the root under none.
  const contents = new Map<
    string | undefined,
    {
      bookmark?: Bookmark;
      folder?: BookmarkFolder;
      id: string;
      order: number;
    }[]
  >();
  const into = (
    at: string | undefined,
    entry: { bookmark?: Bookmark; folder?: BookmarkFolder },
  ) => {
    const { id, order } = entry.bookmark ??
      entry.folder ?? { id: "", order: 0 };
    contents.set(at, [...(contents.get(at) ?? []), { ...entry, id, order }]);
  };
  for (const bookmark of state.bookmarks) {
    const folder = folderOf(state, bookmark);
    if (folder) {
      into(folder.id, { bookmark });
    } else if (bookmark.root === root) {
      into(undefined, { bookmark });
    }
  }
  for (const folder of state.folders) {
    const parent = parentOf(state, folder);
    if (parent) {
      into(parent.id, { folder });
    } else if (folderRootOf(state, folder.id) === root) {
      into(undefined, { folder });
    }
  }
  const itemsOf = (at: string | undefined): BarItem[] =>
    inOrder(contents.get(at) ?? []).flatMap(
      ({ bookmark, folder }): BarItem[] =>
        folder
          ? [{ folder, items: itemsOf(folder.id), kind: "folder" }]
          : bookmark
            ? [{ bookmark, kind: "bookmark" }]
            : [],
    );
  return itemsOf(undefined);
}

/** What a folder shows, the folders in it with what is in them; none for a folder not there. */
export function itemsOfFolder(state: Bookmarks, id: string): BarItem[] {
  const find = (items: readonly BarItem[]): BarItem[] | undefined => {
    for (const item of items) {
      if (item.kind === "folder") {
        const found = item.folder.id === id ? item.items : find(item.items);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  };
  return (
    find(rootItems(state, undefined)) ??
    find(rootItems(state, OTHER_ROOT)) ??
    []
  );
}

/** The bar's items, bookmarks and folders sorted together by order. */
export function barItems(state: Bookmarks): BarItem[] {
  return rootItems(state, undefined);
}

/** Where a bookmark or folder added to the bar now sorts: after everything on it. */
export function orderOnBar(state: Bookmarks): number {
  return orderAfter(siblingsIn(state, undefined));
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
  return inOrder([
    ...state.bookmarks.filter(
      (bookmark) => folderOf(state, bookmark)?.id === folder,
    ),
    ...state.folders.filter((each) => parentOf(state, each)?.id === folder),
  ]);
}

/** A place a bookmark or folder can be kept, as a list of them shows it. */
export interface ListedPlace {
  /** How far under its root: 0 for a root, 1 for a folder loose in one. */
  depth: number;
  /** The place's key (`placeOfKey`). */
  key: string | undefined;
  title: string;
}

/**
 * The places a bookmark can be kept, in the order a tree of them shows:
 * the bar, the folders in it, All Bookmarks, and the folders in it, each
 * folder followed by the ones inside it.
 */
export function bookmarkPlaces(state: Bookmarks): ListedPlace[] {
  const foldersIn = (items: readonly BarItem[], depth: number): ListedPlace[] =>
    items.flatMap((item) =>
      item.kind === "folder"
        ? [
            { depth, key: item.folder.id, title: item.folder.title },
            ...foldersIn(item.items, depth + 1),
          ]
        : [],
    );
  return [
    { depth: 0, key: undefined, title: "Bookmarks bar" },
    ...foldersIn(barItems(state), 1),
    { depth: 0, key: OTHER_ROOT, title: OTHER_ROOT_TITLE },
    ...foldersIn(rootItems(state, OTHER_ROOT), 1),
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
