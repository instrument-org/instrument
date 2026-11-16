import fs from "node:fs";
import path from "node:path";

import { safeName } from "./chat-folders/folder-name";
import {
  legacyChatTitle,
  legacyTaskRecordsDir,
  legacyTaskRecordsRoot,
} from "./migrate-legacy-tasks";
import {
  freeEntryName,
  isDirectorySync,
  moveEntrySync,
  removeIfEmptySync,
} from "./move-entry";
import { LEGACY_OUTPUT_DIR_NAME, recordMovedOutputs } from "./moved-outputs";
import { type PathMove, rewriteStoredPaths } from "./rewrite-stored-paths";
import { type ChatRecordsSplit } from "./split-chat-records";
import { workspaceLayout } from "./workspace-layout";

/**
 * Moves what each 1.x task handed the person, its `output/`, out of the work
 * folder of the chat made from it into the Files folder, in a folder named
 * for the chat's title (`Files/<title>/`): a folder of that name already
 * there takes the files beside its own, a name taken in it gets a number,
 * and a task whose `output/` holds nothing makes no folder. The rest of the
 * work folder stays where it is.
 *
 * A chat is one made from a 1.x task when the migration kept that task's
 * records for it (`legacyTaskRecordsDir`), which is also where its title is
 * read from, as the migration chose it. Runs after the split that put the
 * chat's work in its work folder, in the same sweep, so it serves the chats
 * that sweep made and the ones an earlier build made alike.
 *
 * Each entry's new place is written down before it moves, by the path the
 * chat's messages name it by (`output/<name>`), for the person's views to
 * find it (`movedOutputOf`), and the paths stored elsewhere are written
 * where they went (`rewriteStoredPaths`). An entry that could not move is
 * counted and left for the next sweep. Synchronous, with no store open.
 */
export function moveLegacyOutputsToFiles({
  filesDir,
  machineDir,
  rootDir,
  workFoldersDir,
}: {
  /** The Files folder, made when the first file is moved into it. */
  filesDir: string;
  machineDir: string;
  rootDir: string;
  workFoldersDir: string;
}): ChatRecordsSplit {
  const result: ChatRecordsSplit = { done: [], failed: 0 };
  const { chatsDir } = workspaceLayout(rootDir);
  const moves: PathMove[] = [];
  for (const chatId of readDirs(legacyTaskRecordsRoot(rootDir))) {
    const outputDir = path.join(workFoldersDir, chatId, LEGACY_OUTPUT_DIR_NAME);
    if (
      !isDirectorySync(path.join(chatsDir, chatId)) ||
      !isDirectorySync(outputDir)
    ) {
      continue;
    }
    const entries = fs.readdirSync(outputDir);
    if (entries.length === 0) {
      removeIfEmptySync(outputDir);
      continue;
    }
    const title = legacyChatTitle(legacyTaskRecordsDir(rootDir, chatId));
    const to = path.join(filesDir, safeName(title));
    let count = 0;
    for (const entry of entries) {
      const from = path.join(outputDir, entry);
      try {
        fs.mkdirSync(to, { recursive: true });
        const placed = path.join(to, freeEntryName(to, entry));
        recordMovedOutputs({
          chatId,
          machineDir,
          moved: { [`${LEGACY_OUTPUT_DIR_NAME}/${entry}`]: placed },
        });
        moveEntrySync(from, placed);
        moves.push({ from, to: placed });
        count++;
      } catch (error) {
        result.failed++;
        result.done.push(`could not move ${from} (${String(error)})`);
      }
    }
    removeIfEmptySync(outputDir);
    if (count > 0) {
      result.done.push(
        `${chatId}: ${count.toString()} entr${count === 1 ? "y" : "ies"} from output/ into ${to}`,
      );
    }
  }
  result.done.push(...rewriteStoredPaths({ machineDir, moves, rootDir }));
  return result;
}

function readDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
