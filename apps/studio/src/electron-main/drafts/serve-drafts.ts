import { getWorkspaceFolder } from "@/electron-main/lib/get-workspace-folder";
import {
  DRAFTS_CHANNEL,
  type DraftOp,
  type DraftOpBatch,
  type DraftsSnapshot,
} from "@/shared/drafts";
import { BrowserWindow, ipcMain, shell } from "electron";

import { logger } from "../lib/electron-logger";
import { createDraftStore } from "./draft-store";

/** What a window loading before the workspace opens reads. */
const NO_DRAFTS: DraftsSnapshot = { acks: {}, drafts: [] };

let STORE: null | ReturnType<typeof createDraftStore> = null;

/** Main's own readers of the drafts, told of each change as the windows are. */
const listeners = new Set<(snapshot: DraftsSnapshot) => void>();

/** The batches main sends as a writer of its own, numbered as a window's are. */
const MAIN_CLIENT = "main";
let mainSeq = 0;

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
    moveToTrash: (target) => shell.trashItem(target),
    onChange: tell,
    rootDir: getWorkspaceFolder(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const store = STORE;
  // A window that loaded before the drafts were read has none.
  store.load().then(() => tell(store.snapshot()), couldNotRead);
  store.watch(() => {
    store.reconcile().catch(couldNotRead);
  });
}

function couldNotRead(error: unknown) {
  logger.error("Could not read the drafts folder", error);
}

/**
 * Hears the drafts as they are now and at each change, until the answer is
 * called: what main's own work on the drafts reads, as a window does.
 */
export function watchDrafts(
  listener: (snapshot: DraftsSnapshot) => void,
): () => void {
  listeners.add(listener);
  if (STORE) {
    listener(STORE.snapshot());
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Changes the drafts from main, as a window's batch of ops would. */
export function applyDraftOpsInMain(ops: DraftOp[]): void {
  mainSeq += 1;
  getStore().apply({ client: MAIN_CLIENT, ops, seq: mainSeq });
}

function tell(snapshot: DraftsSnapshot) {
  tellWindows(snapshot);
  for (const listener of listeners) {
    listener(snapshot);
  }
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
 * is on disk; bytes pasted into a draft; and a file taken out of one. Every
 * change, whichever window or file manager made it, reaches every window.
 * Registered before any window exists; until the workspace opens
 * (`openDrafts`) there are none.
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
  ipcMain.handle(DRAFTS_CHANNEL.trash, (_event, request: unknown) =>
    getStore().trash(request),
  );
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
