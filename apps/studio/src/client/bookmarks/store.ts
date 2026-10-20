import { createOpMirror, memoryMirrorBridge } from "@/client/lib/op-mirror";
import {
  applyBookmarkOps,
  type BookmarkOp,
  type BookmarksBridge,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";

/**
 * The bookmarks as this window shows them: main's (`shared/bookmarks.ts`),
 * with the ops this window has sent and main has not yet applied laid over
 * them (`client/lib/op-mirror.ts`).
 */

/** Main's side, or bookmarks kept in this window's memory where there is no main (tests, a browser). */
const bridge: BookmarksBridge =
  globalThis.window?.api?.bookmarks ??
  memoryMirrorBridge<BookmarksSnapshot, BookmarkOp>(
    { acks: {}, bookmarks: [] },
    (snapshot, ops) => ({
      ...snapshot,
      bookmarks: applyBookmarkOps(snapshot.bookmarks, ops),
    }),
  );

const mirror = createOpMirror({
  bridge,
  show: (snapshot: BookmarksSnapshot, pending: BookmarkOp[]) =>
    applyBookmarkOps(snapshot.bookmarks, pending),
});

/** Every bookmark, in order, as this window shows them. */
export const bookmarksAtom = mirror.shownAtom;

/** Sends ops to main and shows them at once; a batch main refused is taken back off. */
export const applyBookmarkOpsAtom = mirror.applyOpsAtom;
