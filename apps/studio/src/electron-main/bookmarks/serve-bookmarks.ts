import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  BOOKMARKS_CHANNEL,
  type BookmarkOpBatch,
  type BookmarksSnapshot,
} from "@/shared/bookmarks";
import {
  type DeviceId,
  openSyncedStore,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import { logger } from "../lib/electron-logger";
import { createBookmarkStore, importBookmarksFile } from "./bookmark-store";

/**
 * Opens the workspace's bookmarks and answers the windows about them: all of
 * them, synchronously, for a preload that is loading; and each batch of ops a
 * window sends, answered once it is on disk. Every change, whichever window
 * or device made it, reaches every window. A `bookmarks.json` an earlier
 * build left is taken in first. Called before any window exists.
 */
export async function serveBookmarks(device: DeviceId): Promise<void> {
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
  // A change a watch missed shows once the person comes back to a window.
  app.on("browser-window-focus", () => {
    synced.look();
  });
  ipcMain.on(BOOKMARKS_CHANNEL.load, (event) => {
    event.returnValue = store.snapshot();
  });
  ipcMain.handle(BOOKMARKS_CHANNEL.apply, (_event, batch: unknown) => {
    if (!isBatch(batch)) {
      throw new Error("Not a batch of bookmark changes");
    }
    return store.apply(batch);
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
