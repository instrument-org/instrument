import { workspaceWindowDir } from "@/electron-main/lib/get-workspace-folder";
import { publisher } from "@/electron-main/rpc/publisher";
import { appWindowIdOf } from "@/electron-main/windows/app-window-ids";
import { movedFilesAddress } from "@/shared/computer-href";
import { chatOfAddress } from "@/shared/tab-identity";
import {
  isKeptFile,
  KEPT_STATE_CHANNEL,
  type KeptFile,
  type KeptSnapshot,
  SHARED_KEPT_FILES,
  TAB_GROUPS_KEY,
  WINDOW_KEPT_FILE,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { logger } from "../../lib/electron-logger";

/** How long writes gather before a file is written: a burst of navigation is one write. */
const WRITE_DELAY_MS = 250;

/**
 * The windows' kept state as JSON files, one object of keys per file, each in
 * the folder `dirOf` names for it. Read whole on first use; a write lands in memory
 * at once and on disk a beat later, each file replaced by rename so a crash
 * mid-write leaves the old file rather than half of the new one.
 */
export function createKeptStateStore(
  dirOf: (file: KeptFile) => string,
  {
    keptFiles = SHARED_KEPT_FILES,
    nameOf = keptFileName,
  }: {
    keptFiles?: readonly KeptFile[];
    nameOf?: (file: KeptFile) => string;
  } = {},
) {
  let files: Map<KeptFile, Record<string, unknown>> | null = null;
  const dirty = new Set<KeptFile>();
  /** Files that are there and could not be read, left as they are on disk. */
  const unreadable = new Set<KeptFile>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pathOf = (file: KeptFile) => path.join(dirOf(file), nameOf(file));

  const loaded = () => {
    if (files) {
      return files;
    }
    files = new Map();
    for (const file of keptFiles) {
      const read = readObject(pathOf(file));
      if (read === undefined) {
        unreadable.add(file);
      }
      files.set(file, read ?? {});
    }
    return files;
  };

  /** Writes what is waiting, and says whether all of it reached the disk. */
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    let isWritten = true;
    for (const file of dirty) {
      const target = pathOf(file);
      if (unreadable.has(file)) {
        logger.warn(
          `Not writing kept state over ${target}, which could not be read`,
        );
        isWritten = false;
        continue;
      }
      try {
        writeObject(target, loaded().get(file) ?? {});
      } catch (error) {
        logger.error(`Could not write kept state to ${target}`, error);
        isWritten = false;
      }
    }
    dirty.clear();
    return isWritten;
  };

  return {
    /** Drops what is waiting to be written, for a file about to be removed. */
    discard: () => {
      clearTimeout(timer);
      timer = undefined;
      dirty.clear();
    },
    flush,
    get: (file: KeptFile, key: string): unknown => loaded().get(file)?.[key],
    set: (file: KeptFile, key: string, value: unknown) => {
      const current = loaded().get(file) ?? {};
      if (value === undefined) {
        const { [key]: _removed, ...rest } = current;
        loaded().set(file, rest);
      } else {
        loaded().set(file, { ...current, [key]: value });
      }
      dirty.add(file);
      timer ??= setTimeout(flush, WRITE_DELAY_MS);
    },
    /** Every file's keys, for a window loading. */
    snapshot: (): KeptSnapshot => Object.fromEntries(loaded()),
  };
}

/** Where each window's own file lives, beside the files every window shares. */
const WINDOWS_FOLDER = "windows";

/** What a kept file is called in the folder it lives in. */
function keptFileName(file: KeptFile): string {
  return `${file}.json`;
}

/**
 * A kept file written whole, replaced by rename so a crash mid-write leaves
 * the old file rather than half of the new one.
 */
function writeObject(target: string, keys: Record<string, unknown>) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(keys, null, 2)}\n`);
  fs.renameSync(temporary, target);
}

/**
 * Writes every Files address in where the person left off (a tab's, and a
 * step of its history: `/files?root=<path>`) naming its folder or its file
 * where a move took it (`where`), so a tab left in the workspace's own folder
 * opens where that folder is now. Written once, by the move that made it,
 * into the file a window reads as it loads, which is why it names the folder
 * the window state is kept in rather than reading the open workspace's.
 *
 * Safe to run again: an address already naming where its folder is is left
 * alone. A file that cannot be read or written is left for the next launch,
 * and nothing here throws.
 */
export function rewriteFolderAddresses(
  windowDir: string,
  where: (hostPath: string) => string,
): string[] {
  const windowsDir = path.join(windowDir, WINDOWS_FOLDER);
  let windowFiles: string[] = [];
  try {
    windowFiles = fs
      .readdirSync(windowsDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => path.join(windowsDir, name));
  } catch {
    // A workspace no window of this build has opened has none.
  }
  return [
    ...SHARED_KEPT_FILES.map((file) => path.join(windowDir, keptFileName(file))),
    ...windowFiles,
  ].flatMap((file) => rewriteAddressesIn(file, where));
}

function rewriteAddressesIn(
  file: string,
  where: (hostPath: string) => string,
): string[] {
  let rewritten = 0;
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.startsWith("/files?")) {
        return value;
      }
      const moved = movedFilesAddress(value, (hostPath) =>
        path.isAbsolute(hostPath) ? where(hostPath) : hostPath,
      );
      if (moved !== value) {
        rewritten += 1;
      }
      return moved;
    }
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry)]),
      );
    }
    return value;
  };
  const keys = Object.fromEntries(
    Object.entries(readObject(file) ?? {}).map(([key, value]) => [
      key,
      visit(value),
    ]),
  );
  if (rewritten === 0) {
    return [];
  }
  try {
    writeObject(file, keys);
  } catch (error) {
    return [`left ${file} as it is (${String(error)})`];
  }
  return [
    `wrote ${rewritten.toString()} address(es) where they went in ${file}`,
  ];
}

/**
 * A file's object, or an empty one for a file that is missing; undefined for
 * one that is there and could not be read (another program holding it, a
 * refused folder), which is no reason to write over it. A file that is not
 * an object of JSON is set aside under another name first (`setAside`), so
 * the next write starts a new one and the old stays for a person to look at;
 * one that cannot be set aside is not read at all.
 */
function readObject(file: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    logger.warn(`Could not read kept state in ${file}`, error);
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value));
    }
  } catch {
    // Set aside below with the case of JSON that is not an object.
  }
  return setAside(file) ? {} : undefined;
}

/** A kept file that is not an object of JSON, renamed beside itself; false when it could not be. */
function setAside(file: string): boolean {
  const aside = `${file}.corrupt-${Date.now().toString()}`;
  try {
    fs.renameSync(file, aside);
  } catch (error) {
    logger.warn(`Could not set aside kept state in ${file}`, error);
    return false;
  }
  logger.warn(`Set aside kept state in ${file}, not a JSON object, as ${aside}`);
  return true;
}

let STORE: null | ReturnType<typeof createKeptStateStore> = null;

/**
 * Where the person left off and how they like things laid out are this
 * computer's, whose screens and paths they are measured against.
 */
function getStore() {
  STORE ??= createKeptStateStore(() => workspaceWindowDir());
  return STORE;
}

const windowStores = new Map<string, ReturnType<typeof createKeptStateStore>>();

/** The first window of a workspace. */
export const FIRST_APP_WINDOW_ID = "app";

/** What one window keeps for itself, in a file named for it. */
function windowStoreOf(windowId: string) {
  const known = windowStores.get(windowId);
  if (known) {
    return known;
  }
  const store = createKeptStateStore(
    () => path.join(workspaceWindowDir(), WINDOWS_FOLDER),
    {
      keptFiles: [WINDOW_KEPT_FILE],
      nameOf: () => `${windowId}.json`,
    },
  );
  windowStores.set(windowId, store);
  return store;
}

/** What a window keeps for itself, by key, for handing all of it to another. */
export function windowKeptKeys(windowId: string) {
  return Object.keys(
    windowStoreOf(windowId).snapshot()[WINDOW_KEPT_FILE] ?? {},
  );
}

/** One value a window keeps for itself, for what the main process does with its tabs. */
export function getWindowKeptState(windowId: string, key: string): unknown {
  return windowStoreOf(windowId).get(WINDOW_KEPT_FILE, key);
}

/** A value a window opens with, written before it loads. */
export function setWindowKeptState(
  windowId: string,
  key: string,
  value: unknown,
) {
  windowStoreOf(windowId).set(WINDOW_KEPT_FILE, key, value);
}

/** A value a window keeps, written from outside it and told to its page as it runs. */
export function tellWindowKeptState(
  windowId: string,
  contents: Electron.WebContents,
  key: string,
  value: unknown,
) {
  setWindowKeptState(windowId, key, value);
  if (!contents.isDestroyed()) {
    contents.send(KEPT_STATE_CHANNEL.changed, WINDOW_KEPT_FILE, key, value);
  }
}

/** Every other window's kept value of a key, for windows on disk and in memory alike. */
function otherWindowsValues(key: string, exceptId: string | undefined) {
  const windowsDir = path.join(workspaceWindowDir(), WINDOWS_FOLDER);
  const onDisk = fs.existsSync(windowsDir)
    ? fs
        .readdirSync(windowsDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
    : [];
  return [...new Set([...onDisk, ...windowStores.keys()])].flatMap((id) => {
    if (id === exceptId) {
      return [];
    }
    const value = getWindowKeptState(id, key);
    return value === undefined ? [] : [value];
  });
}

/** Forgets what a window kept, once it can no longer come back. */
export function forgetWindowKeptState(windowId: string) {
  windowStores.get(windowId)?.discard();
  windowStores.delete(windowId);
  const file = path.join(
    workspaceWindowDir(),
    WINDOWS_FOLDER,
    `${windowId}.json`,
  );
  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    // Another program holding it, and this runs as a window closes.
    logger.warn(`Could not remove kept state in ${file}`, error);
  }
}

/** One kept value, for the main process's own use of what a window keeps. */
export function getKeptState(file: KeptFile, key: string): unknown {
  return getStore().get(file, key);
}

/**
 * Sets one kept value from the main process, for a window that has not loaded
 * yet: one already open does not hear of it.
 */
export function setKeptState(file: KeptFile, key: string, value: unknown) {
  getStore().set(file, key, value);
}

const KeptTabGroupSchema = z.object({
  tabs: z.array(
    z.object({
      href: z.string().optional(),
      id: z.string(),
      openedBy: z.string().optional(),
      promptedAt: z.number().optional(),
    }),
  ),
});

/** Every tab kept in a tab group, with its group's key. */
function keptGroupedTabs() {
  const prefix = `${WINDOW_TABS_KEY}/`;
  const groups = getStore().snapshot().groups ?? {};
  return Object.entries(groups).flatMap(([key, value]) => {
    const tabs = key.startsWith(prefix)
      ? KeptTabGroupSchema.safeParse(value).data?.tabs
      : undefined;
    const group = key.slice(prefix.length);
    return (tabs ?? []).map((tab) => ({ ...tab, group }));
  });
}

/** The chat whose agent opened a tab, by the tab's id; undefined for one the person opened. */
export function keptOpenerOfTab(tabId: string): string | undefined {
  return keptGroupedTabs().find((tab) => tab.id === tabId)?.openedBy;
}

/**
 * The tab group a chat's agent works in: the group of the chat's tab the
 * person last sent it a message from, else of its first tab. Undefined for a
 * chat with no tab.
 */
export function keptWorkingGroupOfChat(chat: string): string | undefined {
  const tabs = keptGroupedTabs().filter(
    (tab) => tab.href !== undefined && chatOfAddress(tab.href) === chat,
  );
  return tabs.reduce<(typeof tabs)[number] | undefined>(
    (found, tab) =>
      found === undefined || (tab.promptedAt ?? 0) > (found.promptedAt ?? 0)
        ? tab
        : found,
    undefined,
  )?.group;
}

/** Writes what is still waiting, at once. The quit calls it on its way out. */
export function flushKeptState() {
  STORE?.flush();
  for (const store of windowStores.values()) {
    store.flush();
  }
}

/**
 * Answers the windows: every file, synchronously, for a preload that is
 * loading; and each write, which goes to the other windows too so a window
 * already open keeps up, unless it is what that window keeps for itself. A
 * write names one of the kept files, never a path. Registered before any
 * window exists.
 */
export function serveKeptState() {
  ipcMain.on(KEPT_STATE_CHANNEL.load, (event) => {
    const windowId = appWindowIdOf(event.sender.id);
    event.returnValue = {
      ...getStore().snapshot(),
      ...(windowId === undefined ? {} : windowStoreOf(windowId).snapshot()),
    } satisfies KeptSnapshot;
  });
  ipcMain.on(KEPT_STATE_CHANNEL.otherWindows, (event, key: unknown) => {
    event.returnValue =
      typeof key === "string"
        ? otherWindowsValues(key, appWindowIdOf(event.sender.id))
        : [];
  });
  ipcMain.on(
    KEPT_STATE_CHANNEL.set,
    (event, file: unknown, key: unknown, value: unknown) => {
      if (!isKeptFile(file) || typeof key !== "string") {
        return;
      }
      if (file === WINDOW_KEPT_FILE) {
        const windowId = appWindowIdOf(event.sender.id);
        if (windowId !== undefined) {
          windowStoreOf(windowId).set(file, key, value);
        }
        // Every window lists what the others have open.
        if (key === TAB_GROUPS_KEY) {
          publisher.publish("window.tab-groups-changed", null);
        }
        return;
      }
      getStore().set(file, key, value);
      // A chat's tab opened, closed or moved changes what each window has open.
      if (key.startsWith(`${WINDOW_TABS_KEY}/`)) {
        publisher.publish("window.tab-groups-changed", null);
      }
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send(KEPT_STATE_CHANNEL.changed, file, key, value);
        }
      }
    },
  );
}
