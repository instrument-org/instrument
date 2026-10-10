import {
  getWorkspaceFolder,
  workspaceSettingsDir,
} from "@/electron-main/lib/get-workspace-folder";
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
import { createDraftsFolder, DRAFTS_DIR_NAME } from "./drafts-folder";

/** How long writes gather before a file is written: a burst of navigation is one write. */
const WRITE_DELAY_MS = 250;

/**
 * Where a kept file's keys are held when it is not a JSON file of its own:
 * read whole, written whole, and told about changes made to it from outside
 * the app, which `reconcile` brings into what the windows hold.
 */
export interface KeptBacking {
  read(): Record<string, unknown>;
  reconcile(
    current: Record<string, unknown>,
  ): Record<string, unknown> | undefined;
  watch(onChange: () => void): () => void;
  write(keys: Record<string, unknown>): void;
}

/**
 * The windows' kept state over a folder of JSON files, one object of keys
 * per file in `KEPT_FILES`, except a file with a backing of its own. Read
 * whole on first use; a write lands in memory at once and on disk a beat
 * later, each file replaced by rename so a crash mid-write leaves the old
 * file rather than half of the new one.
 */
export function createKeptStateStore(
  dir: string,
  backings: Partial<Record<KeptFile, KeptBacking>> = {},
) {
  let files: Map<KeptFile, Record<string, unknown>> | null = null;
  const dirty = new Set<KeptFile>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pathOf = (file: KeptFile) => path.join(dir, `${file}.json`);

  const loaded = () => {
    if (files) {
      return files;
    }
    files = new Map();
    for (const file of KEPT_FILES) {
      files.set(file, backings[file]?.read() ?? readObject(pathOf(file)));
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
      const backing = backings[file];
      if (backing) {
        backing.write(loaded().get(file) ?? {});
        continue;
      }
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
    /**
     * Calls back with each key a backing's file changed from outside the
     * app, after taking it in; returns the stop.
     */
    watch: (
      onChange: (file: KeptFile, key: string, value: unknown) => void,
    ): (() => void) => {
      const stops = Object.entries(backings).flatMap(([name, backing]) => {
        if (!isKeptFile(name) || !backing) {
          return [];
        }
        const file = name;
        return [
          backing.watch(() => {
            const next = backing.reconcile(loaded().get(file) ?? {});
            if (next === undefined) {
              return;
            }
            loaded().set(file, { ...loaded().get(file), ...next });
            for (const [key, value] of Object.entries(next)) {
              onChange(file, key, value);
            }
          }),
        ];
      });
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
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
  STORE ??= createKeptStateStore(workspaceSettingsDir(), {
    drafts: createDraftsFolder(
      path.join(getWorkspaceFolder(), DRAFTS_DIR_NAME),
    ),
  });
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
 * already open keeps up (the onboarding window and the app window share the
 * zoom). A write names one of the kept files, never a path. Registered before
 * any window exists.
 */
export function serveKeptState() {
  // A draft changed in its folder reaches every window, the one that wrote
  // last included, since none of them made the change.
  getStore().watch((file, key, value) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(KEPT_STATE_CHANNEL.changed, file, key, value);
      }
    }
  });
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
