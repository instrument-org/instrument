import { currentWorkspaceScope } from "@/electron-main/lib/workspace-scope";
import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  BOOKMARKS_CHANNEL,
  type BookmarkOpBatch,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import {
  type DeviceId,
  openSyncedStore,
  type SyncedStore,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { logger } from "../lib/electron-logger";
import { createBookmarkStore, importBookmarksFile } from "./bookmark-store";

interface OpenBookmarks {
  store: ReturnType<typeof createBookmarkStore>;
  synced: SyncedStore;
}

/** What the bookmarks of a workspace are kept under in its scope. */
const BOOKMARKS = {};

/** The bookmarks of the workspace open now, once `openBookmarks` has opened them. */
function opened(): OpenBookmarks | undefined {
  return currentWorkspaceScope().peek<OpenBookmarks>(BOOKMARKS);
}

/**
 * Opens the bookmarks of the workspace open now, as `device`: a
 * `bookmarks.json` an earlier build left is taken in first. Called before
 * the workspace's first window opens, and again for each workspace opened
 * after it.
 */
export async function openBookmarks(device: DeviceId): Promise<void> {
  const layout = workspaceLayout(getWorkspaceFolder());
  const synced = openSyncedStore({
    device,
    devicesDir: layout.devicesDir,
    domain: "bookmarks",
    onError: (error) => {
      logger.warn("Bookmarks: could not read another device's changes", error);
    },
  });
  const store = createBookmarkStore({ onChange: tellWindows, store: synced });
  currentWorkspaceScope().value(
    BOOKMARKS,
    () => ({ store, synced }),
    () => {
      synced.close();
    },
  );
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
}

/** The bookmarks open now; a window asks only once they are. */
function openStore() {
  const open = opened();
  if (!open) {
    throw new Error("The workspace's bookmarks are not open");
  }
  return open;
}

/**
 * Answers the windows about the bookmarks of the workspace open now: all of
 * them, synchronously, for a preload that is loading; and each batch of ops a
 * window sends, answered once it is on disk. Every change, whichever window
 * or device made it, reaches every window. Called once, before any window
 * exists.
 */
export function serveBookmarks(): void {
  // A change a watch missed shows once the person comes back to a window.
  app.on("browser-window-focus", () => {
    opened()?.synced.look();
  });
  ipcMain.on(BOOKMARKS_CHANNEL.load, (event) => {
    event.returnValue = openStore().store.snapshot();
  });
  ipcMain.handle(BOOKMARKS_CHANNEL.apply, (_event, batch: unknown) => {
    if (!isBatch(batch)) {
      throw new Error("Not a batch of bookmark changes");
    }
    return openStore().store.apply(batch);
  });
}

function tellWindows(snapshot: BookmarksSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(BOOKMARKS_CHANNEL.changed, snapshot);
    }
  }
}

/**
 * Whether a window sent a batch at all. The ops in it are the renderer's own,
 * built by the same module main applies them with, so only the envelope is
 * checked here.
 */
function isBatch(value: unknown): value is BookmarkOpBatch {
  return (
    typeof value === "object" &&
    value !== null &&
    "client" in value &&
    typeof value.client === "string" &&
    "seq" in value &&
    typeof value.seq === "number" &&
    "ops" in value &&
    Array.isArray(value.ops)
  );
}
