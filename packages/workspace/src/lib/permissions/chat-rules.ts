import os from "node:os";
import path from "node:path";

import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { type MountedFolder } from "../../schemas/mounted-folder";
import { WINDOW_ID } from "../../schemas/window-id";
import { folderReach } from "../chat/folder-reach";
import { chatGrants } from "../chat/grants";
import { chatDenials } from "./denials";
import { type NativeReach } from "../native-sandbox";
import { nodeToolsDir } from "../tool-isolation";
import { getWorkspaceConfig } from "../workspace-config";
import { type WorkspaceFsLayout } from "../workspace-fs-layout";
import { readPermissionSettings, type Rules, rulesFor } from "./rules";

/**
 * The rules one chat's shell is held to: Settings › Permissions, the chat's
 * grants, and the folders it holds without one (its topics' folders). The
 * home folder is not one of those: it is reached so the agent can look, and
 * the rules decide what in it may change.
 */
export async function chatRules({
  chatId,
  folders = {},
  partId,
  sessionId,
}: {
  chatId: ChatId;
  folders?: Record<string, MountedFolder.Type>;
  /** The tool call they hold, whose card draws under it. */
  partId?: StoreId.Part;
  /** The session that holds to them, whose refusals raise the card. */
  sessionId?: StoreId.Session;
}): Promise<Rules> {
  const home = os.homedir();
  const rules = rulesFor({
    extraAllows: Object.values(folders)
      .map((folder) => folder.path)
      .filter((folderPath) => path.resolve(folderPath) !== path.resolve(home)),
    denials: (await chatDenials(chatId))
      .filter((denial) => denial.kind === "folder")
      .map((denial) => denial.target),
    grants: chatId === WINDOW_ID ? [] : await chatGrants(chatId),
    home,
    settings: await readPermissionSettings(),
  });
  return sessionId
    ? {
        ...rules,
        asker: { chatId, ...(partId && { partId }), sessionId },
      }
    : rules;
}

/** The folders a chat reaches and the rules over them, for building its layout. */
export async function chatReach(
  chatId: ChatId,
  sessionId?: StoreId.Session,
  partId?: StoreId.Part,
): Promise<{
  folders: Record<string, MountedFolder.Type>;
  rules: Rules;
}> {
  const folders = await folderReach(chatId);
  return {
    folders,
    rules: await chatRules({ chatId, folders, partId, sessionId }),
  };
}

/** What a native command the chat's shell spawns is held to. */
export function nativeReachFor(
  rules: Rules,
  layout: WorkspaceFsLayout,
): NativeReach {
  return {
    readOnly: layout.skills.map((mount) => mount.hostRoot),
    readWrite: [
      layout.task.hostRoot,
      getWorkspaceConfig().uvDataDir,
      nodeToolsDir(),
      ...(layout.apps ? [layout.apps.hostRoot] : []),
    ],
    rules,
  };
}
