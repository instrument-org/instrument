import {
  applyBookmarkOps,
  type Bookmark,
  type BookmarkOp,
  type BookmarkOpBatch,
  type BookmarksBridge,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import { atom } from "jotai";
import { ulid } from "ulid";

/**
 * The bookmarks as this window shows them: main's (`shared/bookmarks.ts`),
 * with the ops this window has sent and main has not yet applied laid over
 * them.
 *
 * So a change made here shows at once, and a change main reports from
 * elsewhere (another window, another device) lands under the ones still on
 * their way rather than over them: main applies those after it, and says so
 * with the next snapshot it sends, which is when they come off.
 */

/** This window, among the ones sending main ops. */
const CLIENT = ulid();

/** The number of this window's last batch. */
let lastSeq = 0;

interface Sync {
  /** What main last said the bookmarks are. */
  confirmed: BookmarksSnapshot;
  /** This window's batches main had not applied as of {@link confirmed}, oldest first. */
  pending: BookmarkOpBatch[];
}

/** Main's side, or bookmarks kept in this window's memory where there is no main (tests, a browser). */
const bridge: BookmarksBridge =
  globalThis.window?.api?.bookmarks ?? memoryBridge();

/**
 * The newest snapshot main has sent, kept from the moment the window loads
 * rather than from whenever something first reads the bookmarks, so a change
 * main sends before the first render is not missed.
 */
let latest = bridge.initial;
const listeners = new Set<(snapshot: BookmarksSnapshot) => void>();
bridge.onChange((snapshot) => {
  latest = snapshot;
  for (const listener of listeners) {
    listener(snapshot);
  }
});

/** Takes in a snapshot from main: it is what the bookmarks are, and each batch it acks is off the stack. */
function rebase(sync: Sync, snapshot: BookmarksSnapshot): Sync {
  const applied = snapshot.acks[CLIENT] ?? 0;
  return {
    confirmed: snapshot,
    pending: sync.pending.filter((batch) => batch.seq > applied),
  };
}

const syncStateAtom = atom<Sync | undefined>(undefined);

const syncAtom = atom(
  (get): Sync => get(syncStateAtom) ?? { confirmed: latest, pending: [] },
  (get, set, update: (sync: Sync) => Sync) => {
    set(syncStateAtom, update(get(syncAtom)));
  },
);
syncAtom.onMount = (set) => {
  set((sync) => rebase(sync, latest));
  const listener = (snapshot: BookmarksSnapshot) => {
    set((sync) => rebase(sync, snapshot));
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Every bookmark, in order, as this window shows them. */
export const bookmarksAtom = atom((get): Bookmark[] => {
  const { confirmed, pending } = get(syncAtom);
  return pending.reduce(
    (bookmarks, batch) => applyBookmarkOps(bookmarks, batch.ops),
    confirmed.bookmarks,
  );
});

/**
 * Sends ops to main and shows them at once. A batch main refused is taken
 * back off, so the window shows what main has.
 */
export const applyBookmarkOpsAtom = atom(
  null,
  async (_get, set, ops: BookmarkOp[]): Promise<void> => {
    if (ops.length === 0) {
      return;
    }
    lastSeq += 1;
    const batch: BookmarkOpBatch = { client: CLIENT, ops, seq: lastSeq };
    set(syncAtom, (sync) => ({ ...sync, pending: [...sync.pending, batch] }));
    try {
      await bridge.apply(batch);
    } catch (error) {
      set(syncAtom, (sync) => ({
        ...sync,
        pending: sync.pending.filter((entry) => entry !== batch),
      }));
      throw error;
    }
  },
);

/**
 * Bookmarks kept in this window's memory, for where there is no main to keep
 * them: the same ops applied the same way, answered on the next turn the way
 * main's answer arrives.
 */
function memoryBridge(): BookmarksBridge {
  let snapshot: BookmarksSnapshot = { acks: {}, bookmarks: [] };
  const heard = new Set<(snapshot: BookmarksSnapshot) => void>();
  return {
    apply: (batch) => {
      snapshot = {
        acks: { ...snapshot.acks, [batch.client]: batch.seq },
        bookmarks: applyBookmarkOps(snapshot.bookmarks, batch.ops),
      };
      const sent = snapshot;
      return Promise.resolve().then(() => {
        for (const listener of heard) {
          listener(sent);
        }
      });
    },
    initial: snapshot,
    onChange: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
  };
}
