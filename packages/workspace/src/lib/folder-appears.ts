import ms from "ms";
import { type FSWatcher, statSync, watch } from "node:fs";
import path from "node:path";

/**
 * How often the folder is looked for besides what the parent's watcher
 * reports. On macOS the watcher's stream starts on another thread after
 * `watch` returns, so a folder made in that gap is never reported; a look
 * this often is what finds it.
 */
const LOOK_EVERY_MS = ms("1 second");

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
 * until then, and looking for it every second besides; returns the stop.
 * For a folder the app watches but makes only when there is something to
 * put in it, so a workspace that never used it has none.
 *
 * Every change in the parent is looked at, whatever name it reports, since a
 * folder made on a case-insensitive disk can arrive under another spelling.
 * The parent missing, or its watcher failing, leaves the look every second
 * to find the folder.
 */
export function afterFolderAppears(
  dir: string,
  onAppear: () => void,
): () => void {
  let done = false;
  let watcher: FSWatcher | undefined;
  const timer = setInterval(() => {
    look();
  }, LOOK_EVERY_MS);
  timer.unref();
  const stop = () => {
    done = true;
    clearInterval(timer);
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
    watcher.on("error", () => {
      watcher?.close();
    });
  } catch {
    // Left to the look every second.
  }
  // Made between the caller's look and the watch starting.
  look();
  return stop;
}
