import { workspaceSettingsDir } from "@/electron-main/lib/get-workspace-folder";
import {
  isKeptKey,
  KEPT_STATE_CHANNEL,
  KEPT_STATE_FILES,
  type KeptFile,
  type KeptKey,
} from "@/shared/kept-state";
import { BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../../lib/electron-logger";

/** How long writes gather before a file is written: a burst of navigation is one write. */
const WRITE_DELAY_MS = 250;

/**
 * The windows' kept state over a folder of JSON files, one object per file
 * keyed as `KEPT_STATE_FILES` says. Read whole on first use; a write lands
 * in memory at once and on disk a beat later, each file replaced by rename so
 * a crash mid-write leaves the old file rather than half of the new one.
 */
export function createKeptStateStore(dir: string) {
  let files: Map<KeptFile, Record<string, unknown>> | null = null;
  const dirty = new Set<KeptFile>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fileNames = new Set<KeptFile>(Object.values(KEPT_STATE_FILES));
  const pathOf = (file: KeptFile) => path.join(dir, `${file}.json`);

  const loaded = () => {
    if (files) {
      return files;
    }
    files = new Map();
    for (const file of fileNames) {
      files.set(file, readObject(pathOf(file)));
    }
    return files;
  };

  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (dirty.size === 0) {
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    for (const file of dirty) {
      const target = pathOf(file);
      const temporary = `${target}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(
          temporary,
          `${JSON.stringify(loaded().get(file) ?? {}, null, 2)}\n`,
        );
        fs.renameSync(temporary, target);
      } catch (error) {
        logger.error(`Could not write kept state to ${target}`, error);
      }
    }
    dirty.clear();
  };

  return {
    flush,
    get: (key: KeptKey): unknown => loaded().get(KEPT_STATE_FILES[key])?.[key],
    set: (key: KeptKey, value: unknown) => {
      const file = KEPT_STATE_FILES[key];
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
    /** Every key's value, for a window loading. */
    snapshot: (): Record<string, unknown> =>
      Object.fromEntries(
        [...loaded().values()].flatMap((object) => Object.entries(object)),
      ),
  };
}

/** A file's object, or an empty one for a file that is missing or not an object of JSON. */
function readObject(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return {};
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

function getStore() {
  STORE ??= createKeptStateStore(workspaceSettingsDir());
  return STORE;
}

/** One kept value, for the main process's own use of what a window keeps. */
export function getKeptState(key: KeptKey): unknown {
  return getStore().get(key);
}

/** Writes what is still waiting, at once. The quit calls it on its way out. */
export function flushKeptState() {
  STORE?.flush();
}

/**
 * Answers the windows: the whole state, synchronously, for a preload that is
 * loading; and each write, which goes to the other windows too so a window
 * already open keeps up (the onboarding window and the app window share the
 * zoom). Registered before any window exists.
 */
export function serveKeptState() {
  ipcMain.on(KEPT_STATE_CHANNEL.load, (event) => {
    event.returnValue = getStore().snapshot();
  });
  ipcMain.on(KEPT_STATE_CHANNEL.set, (event, key: unknown, value: unknown) => {
    if (!isKeptKey(key)) {
      return;
    }
    getStore().set(key, value);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window.webContents !== event.sender) {
        window.webContents.send(KEPT_STATE_CHANNEL.changed, key, value);
      }
    }
  });
}
