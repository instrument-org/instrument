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

/** A page the person kept, shown on the browser's starting view. */
export interface Bookmark {
  id: string;
  /** Where it sorts among the others; any number, smaller first. */
  order: number;
  title: string;
  url: string;
}

/** One change to the bookmarks, carrying everything it needs so main and every window apply it alike. */
export type BookmarkOp =
  /** Kept, with an id and an order the window chose. Ignored where the id is taken. */
  | { bookmark: Bookmark; type: "add" }
  /** Moved to sort at `order`. */
  | { id: string; order: number; type: "move" }
  /** No longer kept. */
  | { id: string; type: "remove" }
  | { id: string; title: string; type: "rename" };

/** Main's bookmarks as a window receives them, with the last batch it applied from each window. */
export interface BookmarksSnapshot {
  /** By window: the `seq` of the last batch main applied from it. */
  acks: Record<string, number>;
  /** Every bookmark, in order. */
  bookmarks: Bookmark[];
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

/** Applies ops in order, answering the bookmarks in order. */
export function applyBookmarkOps(
  bookmarks: readonly Bookmark[],
  ops: readonly BookmarkOp[],
): Bookmark[] {
  return inOrder(ops.reduce(applyBookmarkOp, [...bookmarks]));
}

function applyBookmarkOp(bookmarks: Bookmark[], op: BookmarkOp): Bookmark[] {
  switch (op.type) {
    case "add":
      return bookmarks.some((bookmark) => bookmark.id === op.bookmark.id)
        ? bookmarks
        : [...bookmarks, op.bookmark];
    case "move":
      return bookmarks.map((bookmark) =>
        bookmark.id === op.id ? { ...bookmark, order: op.order } : bookmark,
      );
    case "remove":
      return bookmarks.filter((bookmark) => bookmark.id !== op.id);
    case "rename":
      return bookmarks.map((bookmark) =>
        bookmark.id === op.id ? { ...bookmark, title: op.title } : bookmark,
      );
  }
}

/** Sorted by order, ties by id, so every window and device lists them alike. */
export function inOrder(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarks.toSorted((a, b) =>
    a.order === b.order
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.order - b.order,
  );
}

/** Where a bookmark added now sorts: after every one there is. */
export function orderAfter(bookmarks: readonly Bookmark[]): number {
  return bookmarks.reduce(
    (last, bookmark) => Math.max(last, bookmark.order + 1),
    0,
  );
}
