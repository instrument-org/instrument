import path from "node:path";

import { CHATS_FOLDER_NAME } from "../../constants";
import { resolveChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { findChatFolderNames } from "./own-folder";

/**
 * Records, in the background as the workspace starts, the folder of each
 * chat this computer has no folder name for yet, reading every `CHAT.md`
 * off the main thread. A computer opening a synced workspace for the first
 * time knows none of them, and most of its `CHAT.md` files may be in the
 * cloud only.
 */
export function startChatFolderNames(): void {
  const { captureException, rootDir, workspaceMachineDir } =
    getWorkspaceConfig();
  const startedAt = performance.now();
  findChatFolderNames({
    chats: path.join(rootDir, CHATS_FOLDER_NAME),
    isChat: (id) => resolveChat(id) !== undefined,
    machineDir: workspaceMachineDir,
  })
    .then((recorded) => {
      if (recorded > 0) {
        console.info(
          `Chat folders: recorded ${recorded} chats' folders on this computer in ${Math.round(performance.now() - startedAt)}ms`,
        );
      }
    })
    .catch((error: unknown) => {
      captureException(error);
    });
}
