import { keptAtom } from "@/client/lib/kept-state";
import { createOpMirror, memoryMirrorBridge } from "@/client/lib/op-mirror";
import {
  applyBookmarkOps,
  type BookmarkOp,
  type BookmarksBridge,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import { atom } from "jotai";

import { keptPaths } from "./address";

/**
 * The bookmarks as this window shows them: main's (`shared/bookmarks.ts`),
 * with the ops this window has sent and main has not yet applied laid over
 * them (`client/lib/op-mirror.ts`).
 */

/** Main's side, or bookmarks kept in this window's memory where there is no main (tests, a browser). */
const bridge: BookmarksBridge =
  globalThis.window?.api?.bookmarks ??
  memoryMirrorBridge<BookmarksSnapshot, BookmarkOp>(
    { acks: {}, bookmarks: [], folders: [] },
    (snapshot, ops) => ({ ...snapshot, ...applyBookmarkOps(snapshot, ops) }),
  );

const mirror = createOpMirror({
  bridge,
  show: (snapshot: BookmarksSnapshot, pending: BookmarkOp[]) =>
    applyBookmarkOps(snapshot, pending),
});

/** Every bookmark and every folder of the bar, in order, as this window shows them. */
export const bookmarksStateAtom = mirror.shownAtom;

/** Every bookmark, on the bar or in a folder, in order, as this window shows them. */
export const bookmarksAtom = atom((get) => get(bookmarksStateAtom).bookmarks);

/** The paths of the files and folders kept as bookmarks (`keptPaths`), for Files to star them. */
export const keptPathsAtom = atom((get) => keptPaths(get(bookmarksAtom)));

/** Sends ops to main and shows them at once; a batch main refused is taken back off. */
export const applyBookmarkOpsAtom = mirror.applyOpsAtom;

/**
 * Where the address bar's star files a new bookmark, by the place's key
 * (`placeOfKey`): the folder or Other bookmarks last picked for a bookmark,
 * as a browser's star remembers it, or the bar (`null`) until one is. A
 * folder removed since leaves the bar.
 */
export const lastBookmarkFolderAtom = keptAtom<string | null>(
  "layout",
  "bookmark-folder.v1",
  null,
);
