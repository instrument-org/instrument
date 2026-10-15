import { readdirSync, realpathSync } from "node:fs";
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
import { runtimeLayout } from "../runtime-dir";
import { skillSourceRoots } from "../skills";
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
    // The same folders the shell mounts read-only, so the file tools and the
    // commands agree about a skill the agent was told to read where it is.
    extraReadOnly: skillSourceRoots(getWorkspaceConfig())
      .filter((root) => root.readOnly)
      .map((root) => root.dir),
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

/**
 * The app's bin folder and the folders its links lead to, which a program
 * has to read to run `node` or `pnpm` off PATH. Read once per folder: the
 * links are made at launch.
 */
const toolBinFolderCache = new Map<string, string[]>();

function toolBinFolders(toolBinDir: string): string[] {
  let folders = toolBinFolderCache.get(toolBinDir);
  if (!folders) {
    let entries: string[] = [];
    try {
      entries = readdirSync(toolBinDir);
    } catch {
      // Not made yet; the folder alone is opened.
    }
    const targets = entries.flatMap((entry) => {
      try {
        return [path.dirname(realpathSync(path.join(toolBinDir, entry)))];
      } catch {
        return [];
      }
    });
    folders = [...new Set([toolBinDir, ...targets])];
    toolBinFolderCache.set(toolBinDir, folders);
  }
  return folders;
}

/** What a native command the chat's shell spawns is held to. */
export function nativeReachFor(
  rules: Rules,
  layout: WorkspaceFsLayout,
): NativeReach {
  const runtime = runtimeLayout(getWorkspaceConfig().runtimeDir);
  return {
    readOnly: [
      ...layout.skills.map((mount) => mount.hostRoot),
      ...toolBinFolders(runtime.bin),
      // The managed Pythons every chat's virtualenv runs on, which the app
      // installs (installManagedPython), the skill environments it builds,
      // which every chat runs, and the preload every chat's `node` imports:
      // a file one chat put there would run in every other.
      runtime.python,
      runtime.environments,
      runtime.preload,
    ],
    readWrite: [
      layout.chat.hostRoot,
      runtime.caches,
      runtime.config,
      ...(layout.apps ? [layout.apps.hostRoot] : []),
    ],
    rules,
  };
}
