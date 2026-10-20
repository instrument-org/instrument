import { WORKSPACE_MACHINE_ENTRIES } from "@instrument-org/shared";
import { registerStoredPaths } from "@instrument-org/workspace/electron";
import path from "node:path";

import { rewriteRecentFiles } from "../browser-view/history-store";
import { rewriteFolderAddresses } from "../stores/workspace/kept-state";

/**
 * The stores Studio keeps paths in, registered with `rewriteStoredPaths` so
 * every move writes them where they went: the Files tabs a window is left
 * on, and the files the person opened lately. Both live in the machine
 * folder each call names rather than the open workspace's, since a launch
 * settles the paths of a workspace it is not running, and both are
 * rewritten before anything opens them. Called once, first thing in the
 * launch; calling it again changes nothing.
 */
export function registerAppStoredPaths() {
  registerStoredPaths("window", ({ machineDir, where }) =>
    rewriteFolderAddresses(
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.window),
      where,
    ),
  );
  registerStoredPaths("browser", ({ machineDir, moves }) =>
    rewriteRecentFiles(
      path.join(machineDir, WORKSPACE_MACHINE_ENTRIES.browser),
      moves,
    ),
  );
}
