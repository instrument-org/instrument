import fs from "node:fs";
import path from "node:path";

import {
  entryExists,
  isDirectorySync,
  mergeEntrySync,
  moveEntrySync,
  removeIfEmptySync,
} from "./move-entry";
import { recordMovedPaths } from "./moved-paths";
import { WORKSPACE_DATA_ENTRIES, workspaceLayout } from "./workspace-layout";

/**
 * The app's folders builds before kept at the workspace's top level, under
 * the names they keep in its `.instrument/`. The window's record folder was
 * always there.
 */
const MOVED_ENTRY_NAMES = [
  WORKSPACE_DATA_ENTRIES.apps,
  WORKSPACE_DATA_ENTRIES.chats,
  WORKSPACE_DATA_ENTRIES.drafts,
  WORKSPACE_DATA_ENTRIES.memory,
  WORKSPACE_DATA_ENTRIES.setAside,
  WORKSPACE_DATA_ENTRIES.skills,
  WORKSPACE_DATA_ENTRIES.topics,
];

export interface AppFoldersMove {
  /** One line per folder moved, and one per entry left or failed. */
  done: string[];
  /**
   * Entries that could not be moved, because the move failed or their new
   * place is taken, which the next sweep tries again.
   */
  failed: number;
}

/**
 * Moves the app's folders (`chats/`, `drafts/`, `topics/`, `skills/`,
 * `apps/`, `memory/`, `.pre-chats/`) from the workspace's top level, where
 * builds before kept them, into its `.instrument/`, so the top level is left
 * to the person's own work.
 *
 * A folder whose new place is free is renamed whole (copied, then removed,
 * across volumes, and retried for a moment on Windows); one whose new place
 * is already there has its entries moved into it one by one, and an entry
 * still taken is left where it was. An entry that fails, or whose place is
 * taken, is left in place and counted (`failed`), so the sweep is not marked
 * done and the next one tries it again. Records each move first (`recordMovedPaths`), so a path
 * stored before into one of these folders (a draft's attachments, a chat's
 * grants, a file a reply named, the recent files) is found where it went.
 * Synchronous, with no store open.
 */
export function moveAppFoldersIntoDataDir({
  machineDir,
  rootDir,
}: {
  /** This computer's folder for the workspace, where the moves are recorded. */
  machineDir: string;
  rootDir: string;
}): AppFoldersMove {
  const move: AppFoldersMove = { done: [], failed: 0 };
  const { dataDir } = workspaceLayout(rootDir);
  const waiting = MOVED_ENTRY_NAMES.flatMap((name) => {
    const from = path.join(rootDir, name);
    if (!entryExists(from)) {
      return [];
    }
    if (!isDirectorySync(from)) {
      move.done.push(`left ${from}: it is not a folder`);
      return [];
    }
    return [{ from, name, to: path.join(dataDir, name) }];
  });
  if (waiting.length === 0) {
    return move;
  }

  recordMovedPaths(
    machineDir,
    waiting.map(({ from, to }) => ({ from, to })),
  );
  for (const { from, name, to } of waiting) {
    if (!entryExists(to)) {
      try {
        moveEntrySync(from, to);
        move.done.push(`moved ${name}/ into ${dataDir}`);
      } catch (error) {
        move.failed++;
        move.done.push(
          `could not move ${from} (${String(error)}); left it there`,
        );
      }
      continue;
    }
    // Merged only into a folder: a link's entries are wherever it points.
    if (!isDirectorySync(to)) {
      move.failed++;
      move.done.push(`left ${from}: ${to} is already there`);
      continue;
    }
    let moved = 0;
    for (const entry of fs.readdirSync(from)) {
      try {
        if (
          mergeEntrySync(
            path.join(from, entry),
            path.join(to, entry),
            (left, taken) => {
              move.failed++;
              move.done.push(`left ${left}: ${taken} is already there`);
            },
          )
        ) {
          moved++;
        }
      } catch (error) {
        move.failed++;
        move.done.push(
          `could not move ${path.join(from, entry)} (${String(error)}); left it there`,
        );
      }
    }
    removeIfEmptySync(from);
    move.done.push(
      `moved ${moved.toString()} entr${moved === 1 ? "y" : "ies"} of ${name}/ into ${to}`,
    );
  }
  return move;
}
