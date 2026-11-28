import { isOpBatch } from "@/shared/op-batch";
import {
  getWorkspaceFolder,
  workspaceWindowDir,
} from "@/electron-main/lib/get-workspace-folder";
import {
  DRAFTS_CHANNEL,
  type DraftOp,
  type DraftsSnapshot,
} from "@/shared/drafts";
import {
  type DeviceId,
  whenWorkspaceHasPhone,
} from "@instrument-org/workspace/electron";
import { workspaceLayout } from "@instrument-org/workspace/layout";
import { BrowserWindow, ipcMain, shell } from "electron";

import { logger } from "../lib/electron-logger";
import { createDraftStore } from "./draft-store";
import { createNewTabDrafts } from "./new-tab-drafts";

/** What a window loading before the workspace opens reads. */
const NO_DRAFTS: DraftsSnapshot = { acks: {}, drafts: [], loading: true };

let STORE: null | ReturnType<typeof createDraftStore> = null;

/** Which drafts were started in a new tab here, opened with the store. */
let NEW_TAB_DRAFTS: null | ReturnType<typeof createNewTabDrafts> = null;

/** Whether the store's first read of the folder is over, read or failed. */
let isLoaded = false;

/** The store's snapshot, saying so while its first read is under way. */
function shown(snapshot: DraftsSnapshot): DraftsSnapshot {
  return isLoaded ? snapshot : { ...snapshot, loading: true };
}

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
 * Opens the drafts in the workspace's `.instrument/drafts/` and watches them, once the
 * workspace has a folder: at launch, or once setup's first step places it.
 */
export function openDrafts(deviceId: DeviceId) {
  if (STORE) {
    return;
  }
  STORE = createDraftStore({
    deviceId,
    moveToTrash: (target) => shell.trashItem(target),
    onChange: (snapshot) => {
      tell(shown(snapshot));
    },
    rootDir: getWorkspaceFolder(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const store = STORE;
  const newTabDrafts = createNewTabDrafts({ windowDir: workspaceWindowDir() });
  NEW_TAB_DRAFTS = newTabDrafts;
  // A window that loaded before the drafts were read has none, and waits
  // for this. A read that failed is over too: there is nothing more to wait for.
  void store
    .load()
    .then(() => {
      // Off the launch: nothing waits for what closed tabs left.
      store
        .discard(newTabDrafts.lost(store.snapshot().drafts))
        .catch(couldNotRead);
    })
    .catch(couldNotRead)
    .finally(() => {
      isLoaded = true;
      tell(store.snapshot());
    });
  store.watch(
    () => {
      store.reconcile().catch(couldNotRead);
    },
    {
      hasPhone: (signal) =>
        whenWorkspaceHasPhone({
          devicesDir: workspaceLayout(getWorkspaceFolder()).devicesDir,
          signal,
        }),
    },
  );
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
    listener(shown(STORE.snapshot()));
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

/**
 * Leaves for good the drafts named in closed tabs the person cleared from
 * their history: clearing what can be reopened is not throwing a draft away.
 */
export function keepDraftsNamedIn(value: unknown): void {
  NEW_TAB_DRAFTS?.keepNamedIn(value);
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
    event.returnValue = STORE ? shown(STORE.snapshot()) : NO_DRAFTS;
  });
  ipcMain.handle(DRAFTS_CHANNEL.apply, (_event, batch: unknown) => {
    if (!isOpBatch<DraftOp>(batch)) {
      throw new Error("Not a batch of draft changes");
    }
    const store = getStore();
    store.apply(batch);
    NEW_TAB_DRAFTS?.applied(batch, store.snapshot().drafts);
  });
  ipcMain.handle(DRAFTS_CHANNEL.stage, (_event, request: unknown) => {
    return getStore().stage(request);
  });
  ipcMain.handle(DRAFTS_CHANNEL.trash, (_event, request: unknown) =>
    getStore().trash(request),
  );
}
