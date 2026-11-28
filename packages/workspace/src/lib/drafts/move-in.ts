import fs from "node:fs";
import path from "node:path";

import { numberedName } from "../folder-name";
import { entryExists, moveEntrySync } from "../move-entry";
import { type PathMove, rewriteStoredPaths } from "../rewrite-stored-paths";
import { removeFolderLeftEmpty } from "../system-clutter";
import { type DraftsMigration } from "./migrate";
import { isDraftFileName } from "./draft-file";
import { draftsFolderDir } from "./draft-folder";

/**
 * Where a build before kept the drafts, at the workspace's top level.
 * Spelled out: it is a name from builds before, and nothing writes there now.
 */
const TOP_LEVEL_DRAFTS_FOLDER_NAME = "Drafts";

/**
 * Moves every draft folder (one holding a `DRAFT*.md`) in a top-level
 * `Drafts/`, where a build before kept the drafts, into the drafts folder in
 * `.instrument/`, each under its own name
 * or that name numbered where one is taken there (`2026-10-14 2`), and
 * removes `Drafts/` once nothing is left in it but a file manager's records.
 * A draft is its `id`, never its folder's name, so a renamed folder still
 * holds its draft. Anything else in `Drafts/` is the person's and is left
 * there, and so is `Drafts/` with it.
 *
 * Runs at every launch, since another device, a sync engine or an older
 * build can still put a draft there. Paths the app stored into a folder
 * that moved are written where it went (`rewriteStoredPaths`). Synchronous:
 * renames, with no file read.
 */
export function moveTopLevelDrafts({
  machineDir,
  rootDir,
}: {
  machineDir: string;
  rootDir: string;
}): DraftsMigration {
  const moved: DraftsMigration = { done: [], left: [] };
  const from = path.join(rootDir, TOP_LEVEL_DRAFTS_FOLDER_NAME);
  let folders: string[];
  try {
    folders = fs
      .readdirSync(from, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && holdsDraftFile(path.join(from, entry.name)),
      )
      .map((entry) => entry.name)
      .toSorted();
  } catch {
    return moved;
  }
  const into = draftsFolderDir(rootDir);
  const moves: PathMove[] = [];
  for (const name of folders) {
    const was = path.join(from, name);
    try {
      fs.mkdirSync(into, { recursive: true });
      const to = path.join(into, freeFolderName(into, name));
      moveEntrySync(was, to);
      moves.push({ from: was, to });
      moved.done.push(`moved ${was} to ${to}`);
    } catch (error) {
      moved.left.push({ reason: String(error), where: was });
    }
  }
  removeFolderLeftEmpty(from);
  moved.done.push(...rewriteStoredPaths({ machineDir, moves, rootDir }));
  return moved;
}

/** Whether `dir` has a draft's file in it; a folder that cannot be read has none. */
function holdsDraftFile(dir: string): boolean {
  try {
    // oxlint-disable-next-line studio/no-sync-content-read -- a launch step before the workspace is up, synchronous like the renames it decides; a listing reads no file's contents.
    return fs.readdirSync(dir).some(isDraftFileName);
  } catch {
    return false;
  }
}

/** `name`, or it numbered as the drafts folder numbers its folders, where it is taken. */
function freeFolderName(dir: string, name: string): string {
  let candidate = name;
  for (let suffix = 2; entryExists(path.join(dir, candidate)); suffix += 1) {
    candidate = numberedName(name, suffix);
  }
  return candidate;
}
