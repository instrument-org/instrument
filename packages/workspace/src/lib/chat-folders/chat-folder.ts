import fs from "node:fs/promises";
import path from "node:path";

import { CHAT_FILE_NAME, CHATS_FOLDER_NAME } from "../../constants";
import { syncDirectory } from "../records/sync-directory";
import { claimFolderNamed, safeName } from "./folder-name";

/**
 * A chat's own folder, the one a person opens: `Chats/<title>/`, holding its
 * transcript (`CHAT.md`), what they pasted into it, and what the agent and
 * its tasks made. Its records stay in the workspace's hidden `.instrument/`,
 * and the folder is written from them.
 *
 * The app's hold on the folder is a name in the chat's record settings and
 * nothing else, which is what makes a gesture in a file manager safe:
 *
 * - A renamed or moved folder is not followed. The chat's next change makes a
 *   fresh one by its current title, and the one the person moved is theirs.
 * - A deleted folder comes back the same way.
 * - Nothing here reads the folder back as a record, so an edit to `CHAT.md`
 *   does not last: the next turn writes the file again whole.
 *
 * A name is claimed by making the folder, which the system does atomically,
 * rather than by listing what is there and picking what is free: two chats
 * the person gave one title, settling at the same moment or swept together,
 * would otherwise both pick that name and share one folder.
 */

/** What the chat's folder is named, and where that name puts it. */
export interface ChatFolder {
  /** The folder's name under `Chats/`. */
  name: string;
  /** Where the folder is. */
  path: string;
}

/** Where every chat's folder is: `Chats/` at the workspace's top level. */
function chatsFolderDir(rootDir: string): string {
  return path.join(rootDir, CHATS_FOLDER_NAME);
}

/**
 * The folder the chat should be in, made if it is not there: the one its
 * settings name while that folder is still there, and otherwise a free name
 * from `title`.
 *
 * `folder` is what the chat's settings last named, and the answer says what
 * to record where it differs. Nothing is written to the settings here, so a
 * caller that cannot write them (a sweep over a workspace nobody has open)
 * still gets the folder.
 */
export async function ensureChatFolder({
  folder,
  rootDir,
  title,
}: {
  /** The name the chat's settings last gave its folder, if any. */
  folder: string | undefined;
  rootDir: string;
  title: string | undefined;
}): Promise<ChatFolder> {
  const chats = chatsFolderDir(rootDir);
  if (folder !== undefined && (await isDir(path.join(chats, folder)))) {
    return { name: folder, path: path.join(chats, folder) };
  }
  return claimFolder(chats, title);
}

/**
 * Renames the chat's folder to what `title` now says, for a title that has
 * settled between two turns. Answers with the name the folder ends up under:
 * the name the title gives, a numbered one beside it where another folder
 * holds that name, or the name it had where there is nothing there to rename.
 *
 * Never called while a turn runs: the agent is working in the folder, and a
 * rename under a running command is what moves its own working directory out
 * from under it.
 */
export async function renameChatFolder({
  from,
  rootDir,
  title,
}: {
  /** The folder the chat's settings name now. */
  from: string;
  rootDir: string;
  title: string | undefined;
}): Promise<ChatFolder> {
  const chats = chatsFolderDir(rootDir);
  if (safeName(title) === from) {
    return { name: from, path: path.join(chats, from) };
  }
  if (!(await isDir(path.join(chats, from)))) {
    // A folder the person took away is not followed: the chat keeps the name
    // it had, and its next change makes a folder again under the new title.
    return { name: from, path: path.join(chats, from) };
  }
  // The new name is claimed first, by making the folder, so nothing else can
  // take it between the look and the rename; the claim is then dropped and
  // the chat's own folder renamed into it.
  const claimed = await claimFolder(chats, title);
  await fs.rmdir(claimed.path);
  try {
    await fs.rename(path.join(chats, from), claimed.path);
  } catch (error) {
    if (isMissing(error)) {
      return { name: from, path: path.join(chats, from) };
    }
    throw error;
  }
  await syncDirectory(chats);
  return claimed;
}

/**
 * Writes the chat's transcript into its folder, whole, through a temp name
 * that no sync engine carries and a rename over whatever was there. So a
 * reader of `CHAT.md` sees one render or the one before it, never half of
 * each, and a crash mid-write leaves the older file.
 */
export async function writeChatFile(
  folder: string,
  markdown: string,
): Promise<void> {
  const temp = path.join(folder, `.~${CHAT_FILE_NAME}.tmp`);
  await fs.writeFile(temp, markdown, "utf8");
  await fs.rename(temp, path.join(folder, CHAT_FILE_NAME));
}

/** Makes the chat's folder under a free name from `title` and answers with it. */
function claimFolder(
  chats: string,
  title: string | undefined,
): Promise<ChatFolder> {
  return claimFolderNamed(chats, safeName(title));
}

async function isDir(entry: string): Promise<boolean> {
  try {
    return (await fs.stat(entry)).isDirectory();
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
