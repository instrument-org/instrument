import { app } from "electron";
import fsSync from "node:fs";
import path from "node:path";

/** The checkout an unpackaged build runs from: Electron runs against apps/studio, two levels down. */
export function checkoutRoot() {
  return path.resolve(app.getAppPath(), "..", "..");
}

/**
 * The folder holding the checkout, for a linked worktree only: the main
 * checkout is what every other instance is a deviation from, so naming it says
 * nothing an empty slot doesn't. A linked worktree's `.git` is a file pointing
 * back at the main checkout, where the main checkout's is a directory.
 */
export function worktreeName() {
  if (app.isPackaged) {
    return;
  }
  const root = checkoutRoot();
  try {
    if (fsSync.statSync(path.join(root, ".git")).isFile()) {
      return path.basename(root);
    }
  } catch {
    // Nothing above this run is a checkout, so there is no worktree to name.
  }
  return;
}
