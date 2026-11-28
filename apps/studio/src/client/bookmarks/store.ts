import { keptAtom } from "@/client/lib/kept-state";
import { createOpMirror, memoryMirrorBridge } from "@/client/lib/op-mirror";
import { toast } from "@/client/lib/toast";
import {
  applyBookmarkOps,
  type BookmarkOp,
  type BookmarksBridge,
  type BookmarksSnapshot,
  OTHER_ROOT,
} from "@/shared/bookmarks";
import { instrumentLinkOf } from "@instrument-org/shared";
import { atom, type useStore } from "jotai";

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

/** The ids of the chats kept as bookmarks, by a bookmark of the chat's address (`chatAddressOf`). */
export const bookmarkedChatsAtom = atom((get) => {
  const ids = new Set<string>();
  for (const bookmark of get(bookmarksAtom)) {
    const link = instrumentLinkOf(bookmark.url);
    if (link?.kind === "chat") {
      ids.add(link.name);
    }
  }
  return ids;
});

/**
 * Whether main has read the bookmarks, so `bookmarksStateAtom` says what is
 * kept: until then an address missing from it may only be unread, and ops
 * made from it could keep an address twice.
 */
export const bookmarksLoadedAtom = atom(
  (get) => get(mirror.confirmedAtom).loading !== true,
);

/** What a change to the bookmarks before main has read them is answered with. */
export const BOOKMARKS_LOADING = "Bookmarks are still loading";

/**
 * Sends ops to main and shows them at once; a batch main refused is taken
 * back off. Refused before main has read the bookmarks
 * (`bookmarksLoadedAtom`), since ops made from what the window shows then
 * were made from none: the toast says so, and the rejection is for a caller
 * that awaits it, so one that drops the promise reports no crash.
 */
export const applyBookmarkOpsAtom = atom(
  null,
  (get, set, ops: BookmarkOp[]): Promise<void> => {
    if (!get(bookmarksLoadedAtom)) {
      toast(BOOKMARKS_LOADING);
      const refused = Promise.reject(
        new Error("The bookmarks are still being read."),
      );
      refused.catch(() => undefined);
      return refused;
    }
    return set(mirror.applyOpsAtom, ops);
  },
);

/**
 * Answers once main has read the bookmarks (`bookmarksLoadedAtom`), true, or
 * false once `timeoutMs` passes first.
 */
export function bookmarksRead(
  store: ReturnType<typeof useStore>,
  timeoutMs: number,
): Promise<boolean> {
  if (store.get(bookmarksLoadedAtom)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let stop: (() => void) | undefined;
    const finish = (isRead: boolean) => {
      clearTimeout(timer);
      stop?.();
      resolve(isRead);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    stop = store.sub(bookmarksLoadedAtom, () => {
      if (store.get(bookmarksLoadedAtom)) {
        finish(true);
      }
    });
    // Subscribing takes in main's newest snapshot, which may be the read.
    if (store.get(bookmarksLoadedAtom)) {
      finish(true);
    }
  });
}

/**
 * Where the address bar's star files a new bookmark, by the place's key
 * (`placeOfKey`): the place last picked for a bookmark, as a browser's star
 * remembers it, the bar as `null`, and All Bookmarks until one is picked. A
 * folder removed since leaves All Bookmarks.
 */
export const lastBookmarkFolderAtom = keptAtom<string | null>(
  "layout",
  "bookmark-folder.v1",
  OTHER_ROOT,
  (value, initial) =>
    value === null || typeof value === "string" ? value : initial,
);
