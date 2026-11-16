import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FILE_NAME } from "./chat-transcript";
import { COPY_PATTERN } from "../records/file-names";
import { chatLinkedInFile } from "./chat-link";

/**
 * A sync engine that cannot merge two versions of one file keeps both, the
 * loser under a name of its own: iCloud Drive ` 2`, Dropbox
 * ` (… conflicted copy …)`, OneDrive `-<computer name>`, Syncthing
 * `.sync-conflict-<date>-<time>-<device>` (findings:
 * syncing-a-data-folder-through-file-sync.md).
 *
 * Earlier builds rendered `CHAT.md` from the records after every turn, so a
 * copy of it says nothing the records do not, and it goes with the
 * transcript when `Chats/` is emptied.
 *
 * A name is not enough to delete a file by. `CHAT-notes.md` is both what
 * OneDrive's copy looks like and what a person's own notes look like, so the
 * file has to say it is ours too: its head names a chat, as every transcript
 * we wrote does and nothing a person writes does.
 */

const EXTENSION = path.extname(CHAT_FILE_NAME);
const STEM = path.basename(CHAT_FILE_NAME, EXTENSION);

/**
 * The suffixes a copied name carries, matched once and then kept: the match
 * is made inside a lookahead and repeated through its own backreference, so
 * the engine settles on one way of dividing them rather than searching every
 * way. Written as a plain repeat, a long name of segments that fail to match
 * takes exponentially longer to refuse (file-names.ts).
 */
const CONFLICT_COPY = new RegExp(
  `^${escapeRegExp(STEM)}(?=(?<copy>(?:${COPY_PATTERN})+))\\k<copy>${escapeRegExp(EXTENSION)}$`,
);

/**
 * Whether a file name is what a sync engine calls its copy of `CHAT.md`.
 * True of a name a person could have given a file of their own, which is why
 * {@link deleteChatFileConflictCopies} reads the file before deleting it.
 */
export function isChatFileConflictCopy(name: string): boolean {
  return CONFLICT_COPY.test(name);
}

/**
 * Deletes the sync engines' copies of a chat's transcript from a folder
 * under `Chats/`, and answers with the names that went.
 *
 * Only a file whose name is a copied `CHAT.md` and whose head names a chat:
 * anything else in the folder is the person's or the agent's. A copy a cloud
 * service keeps by name only is left, since its head cannot be read without
 * downloading it, and moves on with the person's files. A real delete rather
 * than the trash, because this runs before the workspace is up, where the
 * trash is not reachable.
 */
export async function deleteChatFileConflictCopies(
  folder: string,
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  const deleted: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isChatFileConflictCopy(entry.name)) {
      continue;
    }
    const file = path.join(folder, entry.name);
    if ((await chatLinkedInFile(file)) === undefined) {
      continue;
    }
    try {
      await fs.rm(file);
      deleted.push(entry.name);
    } catch {
      // Something holds it, or it went on its own between the listing and
      // here; the next launch looks again.
    }
  }
  return deleted.toSorted();
}

function escapeRegExp(text: string) {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}
