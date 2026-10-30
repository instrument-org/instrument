import {
  applyBookmarkOps,
  type Bookmark,
  type BookmarkOpBatch,
  type BookmarksSnapshot,
  inOrder,
} from "@/shared/bookmarks";
import {
  type SyncedOp,
  type SyncedStore,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import { isEqual } from "radashi";
import { z } from "zod";

/**
 * The bookmarks while the app runs, over the workspace's `bookmarks` synced
 * store: a key per bookmark, `bookmark/<id>`, whose value is the rest of it.
 * Two devices changing different bookmarks never touch the same key, and the
 * newest change to one bookmark wins. A window's batch of ops is applied to
 * the bookmarks as they are, and what changed is written as sets and deletes.
 */

const PREFIX = "bookmark/";

const ValueSchema = z.object({
  order: z.number(),
  title: z.string(),
  url: z.string().min(1),
});

export function createBookmarkStore({
  onChange,
  store,
}: {
  /** Told of every change, made here or arriving from another device. */
  onChange: (snapshot: BookmarksSnapshot) => void;
  store: SyncedStore;
}) {
  const acks: Record<string, number> = {};
  /** Changes the store is making for a batch, told with the batch's ack instead. */
  let applying = 0;

  const bookmarks = (): Bookmark[] =>
    inOrder(
      [...store.entries(PREFIX)].flatMap(([key, value]) => {
        const parsed = ValueSchema.safeParse(value);
        return parsed.success
          ? [{ id: key.slice(PREFIX.length), ...parsed.data }]
          : [];
      }),
    );

  const snapshot = (): BookmarksSnapshot => ({
    acks: { ...acks },
    bookmarks: bookmarks(),
  });

  const stop = store.subscribe(() => {
    if (applying === 0) {
      onChange(snapshot());
    }
  });

  return {
    /**
     * Applies a window's batch and writes what it changed, answering once it
     * is on disk; every window then hears the bookmarks with the batch acked.
     */
    apply: async (batch: BookmarkOpBatch): Promise<void> => {
      const before = bookmarks();
      const ops = changesBetween(before, applyBookmarkOps(before, batch.ops));
      applying += 1;
      try {
        await store.apply(ops);
      } finally {
        applying -= 1;
        acks[batch.client] = Math.max(acks[batch.client] ?? 0, batch.seq);
        onChange(snapshot());
      }
    },
    close: stop,
    snapshot,
  };
}

/** The sets and deletes that make `before` into `after`. */
function changesBetween(
  before: readonly Bookmark[],
  after: readonly Bookmark[],
): SyncedOp[] {
  const was = new Map(before.map((bookmark) => [bookmark.id, bookmark]));
  const ops: SyncedOp[] = [];
  for (const bookmark of after) {
    if (!isEqual(was.get(bookmark.id), bookmark)) {
      ops.push({ key: keyOf(bookmark.id), t: "set", value: valueOf(bookmark) });
    }
    was.delete(bookmark.id);
  }
  for (const id of was.keys()) {
    ops.push({ key: keyOf(id), t: "del" });
  }
  return ops;
}

function keyOf(id: string): string {
  return `${PREFIX}${id}`;
}

function valueOf({
  order,
  title,
  url,
}: Bookmark): z.output<typeof ValueSchema> {
  return { order, title, url };
}

/**
 * Seeds the store from the whole-file `bookmarks.json` builds before this one
 * kept in the workspace's `.instrument/`, then removes the file, which no
 * build reads any more. Each bookmark is written as of the file's last
 * change, so anything a device has done since (a rename, a remove) outranks
 * it, and two devices importing the same file write the same bookmarks. A
 * file that cannot be read as bookmarks is left where it is.
 */
export async function importBookmarksFile(
  file: string,
  store: SyncedStore,
): Promise<number | undefined> {
  let raw: string;
  let at: number;
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- launch only: a one-time import of the bookmarks.json earlier builds kept, removed once it is read.
    raw = fs.readFileSync(file, "utf8");
    at = fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  const parsed = FormerFileSchema.safeParse(parseJson(raw));
  if (!parsed.success) {
    return undefined;
  }
  const kept = (parsed.data["bookmarks.v1"] ?? []).flatMap((item) => {
    const bookmark = FormerBookmarkSchema.safeParse(item);
    return bookmark.success ? [bookmark.data] : [];
  });
  await store.apply(
    kept.map((bookmark, order) => ({
      at: Math.floor(at),
      key: keyOf(bookmark.id),
      t: "set",
      value: { order, title: bookmark.title, url: bookmark.url },
    })),
  );
  fs.rmSync(file, { force: true });
  return kept.length;
}

/** What `bookmarks.json` held: the window's bookmarks under their kept key. */
const FormerFileSchema = z.object({
  "bookmarks.v1": z.array(z.unknown()).optional(),
});

const FormerBookmarkSchema = z.object({
  id: z.string().min(1),
  title: z.string().catch(""),
  url: z.string().min(1),
});

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
