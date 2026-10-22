import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  DRAFTS_CHANNEL,
  type DraftOpBatch,
  type DraftsSnapshot,
} from "@/shared/drafts";
import { BrowserWindow, ipcMain } from "electron";

import { createDraftStore } from "./draft-store";

/** What a window loading before the workspace opens reads. */
const NO_DRAFTS: DraftsSnapshot = { acks: {}, drafts: [] };

let STORE: null | ReturnType<typeof createDraftStore> = null;

function getStore() {
  if (!STORE) {
    throw new Error("The drafts were changed before the workspace opened");
  }
  return STORE;
}

/**
 * Opens the drafts in the workspace's `Drafts/` and watches them, once the
 * workspace has a folder: at launch, or once setup's first step places it.
 */
export function openDrafts() {
  if (STORE) {
    return;
  }
  STORE = createDraftStore({
    onChange: tellWindows,
    rootDir: getWorkspaceFolder(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  STORE.load();
  STORE.watch(() => {
    getStore().reconcile();
  });
}

function tellWindows(snapshot: DraftsSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(DRAFTS_CHANNEL.changed, snapshot);
    }
  }
}

/**
 * Answers the windows about the drafts: all of them, synchronously, for a
 * preload that is loading; each batch of ops a window sends, answered once it
 * is on disk; and bytes pasted into a draft. Every change, whichever window
 * or file manager made it, reaches every window. Registered before any window
 * exists; until the workspace opens (`openDrafts`) there are none.
 */
export function serveDrafts() {
  ipcMain.on(DRAFTS_CHANNEL.load, (event) => {
    event.returnValue = STORE?.snapshot() ?? NO_DRAFTS;
  });
  ipcMain.handle(DRAFTS_CHANNEL.apply, (_event, batch: unknown) => {
    if (!isBatch(batch)) {
      throw new Error("Not a batch of draft changes");
    }
    getStore().apply(batch);
  });
  ipcMain.handle(DRAFTS_CHANNEL.stage, (_event, request: unknown) => {
    return getStore().stage(request);
  });
}

/**
 * Whether a window sent a batch at all. The ops in it are the renderer's own,
 * built by the same module main applies them with, so only the envelope is
 * checked here.
 */
function isBatch(value: unknown): value is DraftOpBatch {
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
