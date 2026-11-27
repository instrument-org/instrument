import {
  applyBookmarkOpsFromMain,
  readBookmarks,
  watchBookmarks,
} from "@/electron-main/bookmarks/serve-bookmarks";
import { type Bookmarks } from "@/shared/bookmarks";
import { type Extension, type Session } from "electron";
import { type ElectronChromeExtensions } from "electron-chrome-extensions";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  bookmarkEvents,
  BookmarkSearchSchema,
  bookmarkTree,
  CreateDetailsSchema,
  type DatedBookmarks,
  createOp,
  foundNode,
  MoveDestinationSchema,
  moveOps,
  recentBookmarks,
  removeOp,
  searchBookmarks,
  UpdateChangesSchema,
  updateOps,
  withoutChildren,
} from "./extension-bookmarks";

const BookmarkPermissionsSchema = z.object({
  permissions: z.array(z.unknown()).catch([]),
});

function asksForBookmarks(extension: Pick<Extension, "manifest">) {
  return BookmarkPermissionsSchema.catch({ permissions: [] })
    .parse(extension.manifest)
    .permissions.includes("bookmarks");
}

const IdsSchema = z.union([z.string(), z.array(z.string())]);

/**
 * `chrome.bookmarks` over the app's own bookmarks, which stay the one
 * record: every bookmark as it is kept, a website's, a file's or folder's
 * (`file://`) and the app's own (`instrument://chat/…`) alike, the bar as
 * Chrome's "1" and All Bookmarks as its "2". A change an extension asks for
 * is a batch of the ops a window sends (`applyBookmarkOpsFromMain`), so
 * every window and device sees it as a person's change, and every change,
 * from a window, the agent, another device or an extension, reaches each
 * extension with the `bookmarks` permission as `onCreated`, `onRemoved`,
 * `onChanged` and `onMoved`, from a diff of the bookmarks before and after
 * (`bookmarkEvents`). `onChildrenReordered` and the import events never
 * fire: nothing here sorts a folder or imports. Nothing records when a
 * bookmark was added, so `dateAdded` is when it last changed.
 */
export function answerBookmarkCalls(
  extensions: ElectronChromeExtensions,
  guestSession: Session,
): void {
  // The bookmarks as last told, dated as they were then, since a removed
  // one's own date is gone once it is.
  let known: DatedBookmarks | undefined;
  const dated = (
    bookmarks: Bookmarks,
    changedAt: (id: string) => number | undefined,
  ): DatedBookmarks => {
    const dates = new Map(
      [...bookmarks.bookmarks, ...bookmarks.folders].map(({ id }) => [
        id,
        changedAt(id),
      ]),
    );
    return { bookmarks, dateOf: (id) => dates.get(id) };
  };
  readBookmarks().then(
    ({ bookmarks, changedAt }) => {
      known ??= dated(bookmarks, changedAt);
    },
    () => undefined,
  );
  watchBookmarks((snapshot, changedAt) => {
    const now = dated(
      { bookmarks: snapshot.bookmarks, folders: snapshot.folders },
      changedAt,
    );
    const before = known;
    known = now;
    // The first read, or a change before it, is where events start from.
    if (!before) {
      return;
    }
    const listening = guestSession.extensions
      .getAllExtensions()
      .filter(asksForBookmarks);
    if (listening.length === 0) {
      return;
    }
    for (const [name, ...args] of bookmarkEvents(before, now)) {
      for (const extension of listening) {
        extensions.sendExtensionEvent(extension.id, name, ...args);
      }
    }
  });

  const tree = async () => {
    const { bookmarks, changedAt } = await readBookmarks();
    return { bookmarks, tree: bookmarkTree(bookmarks, changedAt) };
  };

  const answer = (
    name: string,
    callback: (
      event: Parameters<Parameters<typeof extensions.handleApiCall>[1]>[0],
      ...args: unknown[]
    ) => unknown,
  ) => {
    extensions.handleApiCall(`bookmarks.${name}`, callback, {
      permission: "bookmarks",
    });
  };

  answer("get", async (_event, idOrIds) => {
    const { tree: all } = await tree();
    const ids = IdsSchema.parse(idOrIds);
    return (Array.isArray(ids) ? ids : [ids]).map((id) =>
      withoutChildren(foundNode(all, id)),
    );
  });

  answer("getChildren", async (_event, id) => {
    const { tree: all } = await tree();
    return (foundNode(all, id).children ?? []).map(withoutChildren);
  });

  answer("getRecent", async (_event, count) =>
    recentBookmarks((await tree()).tree, count),
  );

  answer("getTree", async () => [(await tree()).tree]);

  answer("getSubTree", async (_event, id) => [
    foundNode((await tree()).tree, id),
  ]);

  answer("search", async (_event, query) =>
    searchBookmarks((await tree()).tree, BookmarkSearchSchema.parse(query)),
  );

  answer("create", async (_event, details) => {
    const { bookmarks } = await tree();
    const id = randomUUID();
    await applyBookmarkOpsFromMain([
      createOp(bookmarks, CreateDetailsSchema.parse(details ?? {}), id),
    ]);
    return withoutChildren(foundNode((await tree()).tree, id));
  });

  answer("move", async (_event, id, destination) => {
    const { bookmarks } = await tree();
    const ops = moveOps(
      bookmarks,
      z.string().parse(id),
      MoveDestinationSchema.parse(destination ?? {}),
    );
    await applyBookmarkOpsFromMain(ops);
    return withoutChildren(foundNode((await tree()).tree, id));
  });

  answer("update", async (_event, id, changes) => {
    const { bookmarks } = await tree();
    await applyBookmarkOpsFromMain(
      updateOps(
        bookmarks,
        z.string().parse(id),
        UpdateChangesSchema.parse(changes ?? {}),
      ),
    );
    return withoutChildren(foundNode((await tree()).tree, id));
  });

  answer("remove", async (_event, id) => {
    const { bookmarks } = await tree();
    await applyBookmarkOpsFromMain([
      removeOp(bookmarks, z.string().parse(id), { recursive: false }),
    ]);
  });

  answer("removeTree", async (_event, id) => {
    const { bookmarks } = await tree();
    await applyBookmarkOpsFromMain([
      removeOp(bookmarks, z.string().parse(id), { recursive: true }),
    ]);
  });
}
