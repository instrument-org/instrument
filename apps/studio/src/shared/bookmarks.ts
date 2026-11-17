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
 * An address the person kept: a website's, a file's or a folder's
 * (`file://<path>`, or the `instrument://file/<path>` an earlier build
 * kept), or the app's own for a chat or a built-in page
 * (`instrument://chat/<id>`, `instrument://screen/<name>`).
 */
export interface Bookmark {
  /**
   * The bar's folder it is filed in, by id. Without one, or where the folder
   * it names is not there (`folderOf`), it is on the bar itself.
   */
  folder?: string;
  id: string;
  /** Where it sorts among the others beside it, on the bar or in its folder; any number, smaller first. */
  order: number;
  title: string;
  url: string;
}

/**
 * A folder on the bookmarks bar, which opens as a menu of the bookmarks
 * filed in it. Folders sit on the bar, one level deep: a folder is never in
 * another, so no chain of folders can loop.
 */
export interface BookmarkFolder {
  id: string;
  /** Where it sorts among the bookmarks and folders on the bar. */
  order: number;
  title: string;
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
   * `folder`, or onto the bar without one. A folder stays on the bar.
   */
  | { folder?: string; id: string; order: number; type: "move" }
  /** No longer kept; a folder goes with every bookmark filed in it. */
  | { id: string; type: "remove" }
  /** A bookmark or a folder under a new name. */
  | { id: string; title: string; type: "rename" };

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
  // Filed in a folder that is not there is on the bar.
  const filedIn = (folder: string | undefined) =>
    folder !== undefined && folders.some((each) => each.id === folder)
      ? { folder }
      : {};
  switch (op.type) {
    case "add": {
      if (isTaken(op.bookmark.id)) {
        return state;
      }
      return {
        bookmarks: [
          ...bookmarks,
          { ...omit(op.bookmark, ["folder"]), ...filedIn(op.bookmark.folder) },
        ],
        folders,
      };
    }
    case "addFolder": {
      const { id, order, title } = op.folder;
      return isTaken(id)
        ? state
        : { bookmarks, folders: [...folders, { id, order, title }] };
    }
    case "move": {
      return {
        bookmarks: bookmarks.map((bookmark) =>
          bookmark.id === op.id
            ? {
                ...omit(bookmark, ["folder"]),
                order: op.order,
                ...filedIn(op.folder),
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
  }
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

/**
 * The folder a bookmark is filed in, where it is there. A bookmark naming a
 * folder another device removed, or one not read yet, is on the bar.
 */
export function folderOf(
  { folders }: Pick<Bookmarks, "folders">,
  bookmark: Bookmark,
): BookmarkFolder | undefined {
  return bookmark.folder === undefined
    ? undefined
    : folders.find((folder) => folder.id === bookmark.folder);
}

/** What the bookmarks bar shows: a bookmark on it, or a folder with the bookmarks filed in it. */
export type BarItem =
  | { bookmark: Bookmark; kind: "bookmark" }
  | { folder: BookmarkFolder; items: Bookmark[]; kind: "folder" };

/** The bookmark or folder a bar item is. */
function memberOf(item: BarItem): Bookmark | BookmarkFolder {
  return item.kind === "folder" ? item.folder : item.bookmark;
}

/**
 * The bar's items, bookmarks and folders sorted together by order. Every
 * bookmark is in exactly one place: in its folder where that is there, on
 * the bar otherwise.
 */
export function barItems(state: Bookmarks): BarItem[] {
  const contents = new Map<string, Bookmark[]>(
    state.folders.map((folder) => [folder.id, []]),
  );
  const onBar: BarItem[] = [];
  for (const bookmark of inOrder(state.bookmarks)) {
    const items =
      bookmark.folder === undefined ? undefined : contents.get(bookmark.folder);
    if (items) {
      items.push(bookmark);
    } else {
      onBar.push({ bookmark, kind: "bookmark" });
    }
  }
  const folders: BarItem[] = state.folders.map((folder) => ({
    folder,
    items: contents.get(folder.id) ?? [],
    kind: "folder",
  }));
  const keyed = [...onBar, ...folders].map((item) => ({
    ...memberOf(item),
    item,
  }));
  return inOrder(keyed).map(({ item }) => item);
}

/** Where a bookmark or folder added to the bar now sorts: after everything on it. */
export function orderOnBar(state: Bookmarks): number {
  return orderAfter(siblingsIn(state, undefined));
}

/** Every bookmark in the order the bar shows them, each folder's in its place among them. */
export function inBarOrder(state: Bookmarks): Bookmark[] {
  return barItems(state).flatMap((item) =>
    item.kind === "folder" ? item.items : [item.bookmark],
  );
}

/** What sits in `folder` (on the bar without one), in order, as the ids and orders a place among them is found by. */
export function siblingsIn(
  state: Bookmarks,
  folder: string | undefined,
): { id: string; order: number }[] {
  if (folder === undefined) {
    return barItems(state).map(memberOf);
  }
  return inOrder(
    state.bookmarks.filter(
      (bookmark) => folderOf(state, bookmark)?.id === folder,
    ),
  );
}
