import {
  applyBookmarkOps,
  type BookmarkOpBatch,
  type Bookmarks,
  type BookmarksSnapshot,
  inOrder,
  OTHER_ROOT,
} from "@/shared/bookmarks";
import {
  type SyncedOp,
  type SyncedStore,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import { isEqual, omit } from "radashi";
import { z } from "zod";

/**
 * The bookmarks while the app runs, over the workspace's `bookmarks` synced
 * store: a key per bookmark, `bookmark/<id>`, and per folder of the bar,
 * `folder/<id>`, whose value is the rest of it. Two devices changing
 * different members never touch the same key, and the newest change to one
 * member wins. A window's batch of ops is applied to the bookmarks as they
 * are, and what changed is written as sets and deletes.
 *
 * A build from before folders reads only `bookmark/` keys and passes over a
 * value's `folder`, so it shows every bookmark on the bar and no folder; a
 * build from before roots passes over `root`, so it shows All Bookmarks'
 * folders and loose bookmarks on the bar.
 */

const PREFIX = { bookmark: "bookmark/", folder: "folder/" } as const;

/** The root a member is kept in: All Bookmarks, or the bar for none or anything else. */
const RootSchema = z.literal(OTHER_ROOT).optional().catch(undefined);

/**
 * A bookmark's value. `url` is any address, the app's own included, and
 * `folder` the folder it is filed in, where one that is not a name reads as
 * none. A key this build does not read is written back as it was found
 * (`unreadOf`), so a later build's fields outlive a change made here.
 */
const BookmarkValueSchema = z.object({
  folder: z.string().min(1).optional().catch(undefined),
  order: z.number(),
  root: RootSchema,
  title: z.string(),
  url: z.string().min(1),
});

/** A folder's value, read and written back as a bookmark's is. */
const FolderValueSchema = z.object({
  order: z.number(),
  root: RootSchema,
  title: z.string(),
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

  const read = (): Bookmarks => ({
    bookmarks: inOrder(
      [...store.entries(PREFIX.bookmark)].flatMap(([key, value]) => {
        const parsed = BookmarkValueSchema.safeParse(value);
        if (!parsed.success) {
          return [];
        }
        const { folder, order, root, title, url } = parsed.data;
        return [
          {
            id: key.slice(PREFIX.bookmark.length),
            order,
            title,
            url,
            ...(folder === undefined ? {} : { folder }),
            ...(root === undefined ? {} : { root }),
          },
        ];
      }),
    ),
    folders: inOrder(
      [...store.entries(PREFIX.folder)].flatMap(([key, value]) => {
        const parsed = FolderValueSchema.safeParse(value);
        if (!parsed.success) {
          return [];
        }
        const { order, root, title } = parsed.data;
        return [
          {
            id: key.slice(PREFIX.folder.length),
            order,
            title,
            ...(root === undefined ? {} : { root }),
          },
        ];
      }),
    ),
  });

  const snapshot = (): BookmarksSnapshot => ({
    acks: { ...acks },
    ...read(),
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
      const before = read();
      const after = applyBookmarkOps(before, batch.ops);
      const ops = [
        ...changesBetween(store, "bookmark", before.bookmarks, after.bookmarks),
        ...changesBetween(store, "folder", before.folders, after.folders),
      ];
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

/**
 * The sets and deletes of one kind of member that make `before` into `after`. A
 * member's value is written over the one stored, so a key this build does
 * not read stays as it was found.
 */
function changesBetween<T extends { id: string }>(
  store: SyncedStore,
  kind: keyof typeof PREFIX,
  before: readonly T[],
  after: readonly T[],
): SyncedOp[] {
  const was = new Map(before.map((member) => [member.id, member]));
  const ops: SyncedOp[] = [];
  for (const member of after) {
    if (!isEqual(was.get(member.id), member)) {
      const key = `${PREFIX[kind]}${member.id}`;
      ops.push({
        key,
        t: "set",
        value: { ...unreadOf(kind, store.get(key)), ...omit(member, ["id"]) },
      });
    }
    was.delete(member.id);
  }
  for (const id of was.keys()) {
    ops.push({ key: `${PREFIX[kind]}${id}`, t: "del" });
  }
  return ops;
}

/** The fields this build reads off each kind of member, which it writes whole; it keeps the rest as found. */
const READ_FIELDS = {
  bookmark: new Set(["folder", "order", "root", "title", "url"]),
  folder: new Set(["order", "root", "title"]),
};

/** What a stored value has that this build does not read: a later build's own fields. */
function unreadOf(
  kind: keyof typeof PREFIX,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([field]) => !READ_FIELDS[kind].has(field)),
  );
}

function keyOf(id: string): string {
  return `${PREFIX.bookmark}${id}`;
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
    raw = await fs.promises.readFile(file, "utf8");
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
