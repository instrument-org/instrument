import { isOpBatch } from "@/shared/op-batch";
import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  BOOKMARKS_CHANNEL,
  type BookmarkOp,
  type Bookmarks,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import {
  type DeviceId,
  openSyncedStore,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { logger } from "../lib/electron-logger";
import { createBookmarkStore, importBookmarksFile } from "./bookmark-store";

/** How long until bookmarks that could not be opened are tried again. */
const RETRY_MS = 60_000;

let store: null | ReturnType<typeof createBookmarkStore> = null;

/** The read of the workspace's bookmarks under way, which a change waits for. */
let opening: Promise<void> | undefined;
let isReading = false;

/** Main's own readers of every change (`watchBookmarks`). */
const mainListeners = new Set<Parameters<typeof watchBookmarks>[0]>();

/** The number of main's own last batch, which it sends as a window does. */
let mainSeq = 0;

/** What a window loading before the workspace opens reads. */
const NO_BOOKMARKS: BookmarksSnapshot = {
  acks: {},
  bookmarks: [],
  folders: [],
  loading: true,
};

/**
 * Answers the windows about the bookmarks: all of them, synchronously, for a
 * preload that is loading; and each batch of ops a window sends, answered
 * once it is on disk. Every change, whichever window or device made it,
 * reaches every window. Registered before any window exists; until the
 * workspace opens (`openBookmarks`) there are none.
 */
export function serveBookmarks(): void {
  ipcMain.on(BOOKMARKS_CHANNEL.load, (event) => {
    event.returnValue = store?.snapshot() ?? NO_BOOKMARKS;
  });
  ipcMain.handle(BOOKMARKS_CHANNEL.apply, async (_event, batch: unknown) => {
    if (!isOpBatch<BookmarkOp>(batch)) {
      throw new Error("Not a batch of bookmark changes");
    }
    // A window opens before the bookmarks are read, and one changed that
    // soon is applied once they are.
    await opening;
    if (!store) {
      throw new Error("The bookmarks were changed before the workspace opened");
    }
    return store.apply(batch);
  });
}

/**
 * Opens the workspace's bookmarks, once it has a folder: at launch, or once
 * setup's first step places it. A `bookmarks.json` an earlier build left is
 * taken in first.
 */
export function openBookmarks(device: DeviceId): Promise<void> {
  // Opened once: a start of the workspace asked for again finds them open or
  // being read.
  if (store || isReading) {
    return opening ?? Promise.resolve();
  }
  isReading = true;
  opening = (async () => {
    try {
      await open(device);
    } catch (error) {
      // This device's own file could not be read. The windows have no
      // bookmarks and take no change to them until it can.
      logger.error("Bookmarks: could not open them, and will try again", error);
      setTimeout(() => void openBookmarks(device), RETRY_MS).unref();
    } finally {
      isReading = false;
    }
  })();
  return opening;
}

async function open(device: DeviceId): Promise<void> {
  const layout = workspaceLayout(getWorkspaceFolder());
  const synced = await openSyncedStore({
    device,
    devicesDir: layout.devicesDir,
    domain: "bookmarks",
    onError: (error) => {
      logger.warn("Bookmarks: could not read another device's changes", error);
    },
  });
  const opened = createBookmarkStore({ onChange: tellWindows, store: synced });
  try {
    const imported = await importBookmarksFile(
      path.join(layout.dataDir, "bookmarks.json"),
      synced,
    );
    if (imported !== undefined) {
      logger.info(
        `Bookmarks: took in ${imported.toString()} from bookmarks.json`,
      );
    }
  } catch (error) {
    logger.error("Bookmarks: could not take in bookmarks.json", error);
  }
  store = opened;
  // A window that loaded before the workspace opened read none.
  tellWindows(opened.snapshot());
}

function tellWindows(snapshot: BookmarksSnapshot) {
  for (const listener of mainListeners) {
    listener(snapshot, (id) => store?.changedAt(id));
  }
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(BOOKMARKS_CHANNEL.changed, snapshot);
    }
  }
}

/**
 * The bookmarks as main reads them for itself, once the workspace's are
 * read, with when each bookmark or folder last changed, in ms.
 */
export async function readBookmarks(): Promise<{
  bookmarks: Bookmarks;
  changedAt: (id: string) => number | undefined;
}> {
  await opening;
  if (!store) {
    throw new Error("Bookmarks are not available yet");
  }
  const { bookmarks, folders } = store.snapshot();
  return { bookmarks: { bookmarks, folders }, changedAt: store.changedAt };
}

/**
 * Changes the bookmarks from main, as a batch a window sends is applied:
 * written through, then told to every window. Answers once on disk.
 */
export async function applyBookmarkOpsFromMain(
  ops: BookmarkOp[],
): Promise<void> {
  await opening;
  if (!store) {
    throw new Error("Bookmarks are not available yet");
  }
  mainSeq += 1;
  await store.apply({ client: "main", ops, seq: mainSeq });
}

/**
 * Hears every change to the bookmarks, from anywhere, as the windows do,
 * with when each bookmark or folder last changed; returns the stop.
 */
export function watchBookmarks(
  listener: (
    snapshot: BookmarksSnapshot,
    changedAt: (id: string) => number | undefined,
  ) => void,
): () => void {
  mainListeners.add(listener);
  return () => {
    mainListeners.delete(listener);
  };
}
