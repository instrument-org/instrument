import { PRIVATE_FOLDER_NAME } from "@instrument-org/shared";
import path from "node:path";

import { WORKSPACE_DATA_ENTRIES } from "../../src/lib/workspace-layout";

/**
 * The workspace a record folder sits in: the folder above a chat's
 * `.instrument/chats/<chat>`, or above a 1.x `tasks/<id>`.
 */
export function workspaceOfRecord(recordDir: string): string {
  const parts = path.resolve(recordDir).split(path.sep);
  const chatsAt = parts.lastIndexOf(WORKSPACE_DATA_ENTRIES.chats);
  return chatsAt > 1 && parts[chatsAt - 1] === PRIVATE_FOLDER_NAME
    ? parts.slice(0, chatsAt - 1).join(path.sep)
    : path.dirname(path.dirname(path.resolve(recordDir)));
}
