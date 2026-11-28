import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { type WorkDir, WorkDirSchema } from "../schemas/paths";
import { ownFolder } from "./own-file";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The folder a chat works in on this computer: the agent's working directory,
 * where its shell, scripts and file tools run, and where its spills and
 * downloads land. A chat's tasks work in it too. It sits in the
 * workspace's folder in `~/.instrument/work/` (`workFoldersDir`), apart from
 * the chat's records (`chatDir`) and from the app's own data. The chat's first
 * command makes it, and a later one makes it again, empty, once it was
 * removed: by the person, or by the app when the chat came to rest with
 * nothing in it (`reapWorkDir`). An id no chat has throws
 * `TypedError.NotFound`, as `chatDir` does.
 */
export function workDir(id: ChatId): WorkDir {
  // Asked first for the id alone: it names no folder for a chat that is not
  // there.
  chatDir(id);
  return WorkDirSchema.parse(
    path.join(getWorkspaceConfig().workFoldersDir, id),
  );
}

/**
 * The folder every workspace's work folders are in (`~/.instrument/work`).
 * A program the agent runs can change anything in it, rename a work folder
 * and put a link in its place included, and nothing its parent has. What
 * the app writes, reads or removes as itself in a work folder is checked
 * from here down for links (`ownFolder`).
 */
export function workFoldersRoot(): string {
  return path.dirname(getWorkspaceConfig().workFoldersDir);
}

/**
 * Checks that nothing from {@link workFoldersRoot} down to `dir`, a folder
 * in a chat's work folder, is a link, making the folders that are missing
 * where `make` asks; throws where one is (`ownFolder`).
 */
export function ownWorkFolder(
  dir: string,
  { make = false }: { make?: boolean } = {},
): void {
  ownFolder({ dir, folder: workFoldersRoot(), make });
}
