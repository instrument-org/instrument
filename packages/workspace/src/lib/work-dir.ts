import path from "node:path";

import { type ChatId } from "../schemas/chat-id";
import { type WorkDir, WorkDirSchema } from "../schemas/paths";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * The folder a chat works in on this computer: the agent's working directory,
 * where its shell, scripts and file tools run, and where its spills and
 * downloads land. A chat's tasks work in it too. It sits in the workspace's
 * machine folder, apart from the chat's records (`chatDir`), and is made by
 * the chat's first command, empty again if it was removed. An id no chat
 * has throws `TypedError.NotFound`, as `chatDir` does.
 */
export function workDir(id: ChatId): WorkDir {
  // Asked first for the id alone: it names no folder for a chat that is not
  // there.
  chatDir(id);
  return WorkDirSchema.parse(
    path.join(getWorkspaceConfig().workFoldersDir, id),
  );
}
