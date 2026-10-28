import { workspaceWindowDir } from "@/electron-main/lib/get-workspace-folder";
import {
  isKeptFile,
  KEPT_FILES,
  KEPT_STATE_CHANNEL,
  type KeptFile,
  type KeptSnapshot,
} from "@/shared/kept-state";
import { BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../../lib/electron-logger";

/** How long writes gather before a file is written: a burst of navigation is one write. */
const WRITE_DELAY_MS = 250;

/**
 * The windows' kept state as JSON files, one object of keys per file in
 * `KEPT_FILES`, each in the folder `dirOf` names for it. Read whole on first use, through `readAs` for a file
 * whose keys are read back in a shape of their own; a write lands in memory
 * at once and on disk a beat later, each file replaced by rename so a crash
 * mid-write leaves the old file rather than half of the new one.
 */
export function createKeptStateStore(
  dirOf: (file: KeptFile) => string,
  readAs: Partial<
    Record<KeptFile, (keys: Record<string, unknown>) => Record<string, unknown>>
  > = {},
) {
  let files: Map<KeptFile, Record<string, unknown>> | null = null;
  const dirty = new Set<KeptFile>();
  /** Files that are there and could not be read, left as they are on disk. */
  const unreadable = new Set<KeptFile>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pathOf = (file: KeptFile) => path.join(dirOf(file), keptFileName(file));

  const loaded = () => {
    if (files) {
      return files;
    }
    files = new Map();
    for (const file of KEPT_FILES) {
      const read = readObject(pathOf(file));
      if (read === undefined) {
        unreadable.add(file);
      }
      const keys = read ?? {};
      files.set(file, readAs[file]?.(keys) ?? keys);
    }
    return files;
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (dirty.size === 0) {
      return;
    }
    for (const file of dirty) {
      const target = pathOf(file);
      if (unreadable.has(file)) {
        logger.warn(
          `Not writing kept state over ${target}, which could not be read`,
        );
        continue;
      }
      try {
        writeObject(target, loaded().get(file) ?? {});
      } catch (error) {
        logger.error(`Could not write kept state to ${target}`, error);
      }
    }
    dirty.clear();
  };

  return {
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

/** The query keys of a Files address that name a folder or a file by its path. */
const FILES_ADDRESS_PATHS = new Set(["file", "root", "tree"]);

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
  const file = path.join(windowDir, keptFileName("layout"));
  let rewritten = 0;
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.startsWith("/files?")) {
        return value;
      }
      const moved = movedFilesAddress(value, where);
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

function movedFilesAddress(
  address: string,
  where: (hostPath: string) => string,
): string {
  const at = address.indexOf("?");
  const query = address
    .slice(at + 1)
    .split("&")
    .map((pair) => {
      const equals = pair.indexOf("=");
      const key = pair.slice(0, equals);
      if (equals === -1 || !FILES_ADDRESS_PATHS.has(key)) {
        return pair;
      }
      let hostPath: string;
      try {
        hostPath = decodeURIComponent(pair.slice(equals + 1));
      } catch {
        return pair;
      }
      if (!path.isAbsolute(hostPath)) {
        return pair;
      }
      const moved = where(hostPath);
      return moved === hostPath ? pair : `${key}=${encodeURIComponent(moved)}`;
    });
  return `${address.slice(0, at)}?${query.join("&")}`;
}

/**
 * A file's object, or an empty one for a file that is missing or not an
 * object of JSON; undefined for one that is there and could not be read
 * (another program holding it, a refused folder), which is no reason to
 * write over it.
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
    // Reported below with the case of JSON that is not an object.
  }
  logger.warn(`Ignoring kept state in ${file}: not a JSON object`);
  return {};
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

/** One kept value, for the main process's own use of what a window keeps. */
export function getKeptState(file: KeptFile, key: string): unknown {
  return getStore().get(file, key);
}

/** Writes what is still waiting, at once. The quit calls it on its way out. */
export function flushKeptState() {
  STORE?.flush();
}

/**
 * Answers the windows: every file, synchronously, for a preload that is
 * loading; and each write, which goes to the other windows too so a window
 * already open keeps up. A write names one of the kept files, never a path.
 * Registered before any window exists.
 */
export function serveKeptState() {
  ipcMain.on(KEPT_STATE_CHANNEL.load, (event) => {
    event.returnValue = getStore().snapshot();
  });
  ipcMain.on(
    KEPT_STATE_CHANNEL.set,
    (event, file: unknown, key: unknown, value: unknown) => {
      if (!isKeptFile(file) || typeof key !== "string") {
        return;
      }
      getStore().set(file, key, value);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
          window.webContents.send(KEPT_STATE_CHANNEL.changed, file, key, value);
        }
      }
    },
  );
}
