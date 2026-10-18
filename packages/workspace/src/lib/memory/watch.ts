import ms from "ms";
import { type FSWatcher, watch } from "node:fs";

import { publisher } from "../../rpc/publisher";
import { afterFolderAppears, isFolder } from "../folder-appears";
import { getWorkspaceConfig } from "../workspace-config";
import { memoryDir } from "./store";

/** Long enough that a save and the editor's rename around it are one change. */
const SETTLE_MS = ms("150 milliseconds");

/**
 * Tells everyone watching when the memory folder changes under them.
 *
 * A memory is a file a person is invited to edit, and the folder is one click
 * away on the screen that lists them, so what is on screen has to follow what
 * is on disk. Our own writes publish for themselves; this is for the other
 * hand.
 *
 * Flat and small, so `fs.watch` on the one directory is the whole of it: no
 * recursion, no native watcher, nothing to ignore. Kept for as long as a
 * caller holds it, since the only caller is a live query that already has a
 * lifetime.
 */
export async function startWatchingMemory(): Promise<() => void> {
  const dir = memoryDir();
  let watcher: FSWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;

  const changed = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      publisher.publish("memory.changed", null);
    }, SETTLE_MS);
  };
  const start = () => {
    try {
      watcher = watch(dir, changed);
      // A watcher that dies takes the freshness with it and nothing else:
      // the list is still right until the next change nobody hears about.
      watcher.on("error", (error) => {
        getWorkspaceConfig().captureException(error);
      });
    } catch (error) {
      getWorkspaceConfig().captureException(error);
    }
  };

  // An empty memory is the ordinary state of a new workspace, which has no
  // folder until the first memory is saved.
  let stopWaiting: (() => void) | undefined;
  if (isFolder(dir)) {
    start();
  } else {
    stopWaiting = afterFolderAppears(dir, () => {
      start();
      changed();
    });
  }

  return () => {
    stopWaiting?.();
    if (timer) {
      clearTimeout(timer);
    }
    watcher?.close();
  };
}
