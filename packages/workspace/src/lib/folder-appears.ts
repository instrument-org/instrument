import { type FSWatcher, statSync, watch } from "node:fs";
import path from "node:path";

/** Whether `dir` is a folder on disk now. */
export function isFolder(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Calls `onAppear` once, when `dir` turns up, by watching its parent folder
 * until then; returns the stop. For a folder the app watches but makes only
 * when there is something to put in it, so a workspace that never used it
 * has none.
 *
 * Every change in the parent is looked at, whatever name it reports, since a
 * folder made on a case-insensitive disk can arrive under another spelling.
 * The parent itself missing, or its watcher failing, leaves the wait over
 * without a call: nothing is listening for the folder then.
 */
export function afterFolderAppears(
  dir: string,
  onAppear: () => void,
): () => void {
  let done = false;
  let watcher: FSWatcher | undefined;
  const stop = () => {
    done = true;
    watcher?.close();
  };
  const look = () => {
    if (done || !isFolder(dir)) {
      return;
    }
    stop();
    onAppear();
  };
  try {
    watcher = watch(path.dirname(dir), look);
    watcher.on("error", stop);
  } catch {
    done = true;
    return stop;
  }
  // Made between the caller's look and the watch starting.
  look();
  return stop;
}
