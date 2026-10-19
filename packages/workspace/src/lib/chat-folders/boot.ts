import { readTopicsSync } from "../chat/topics";
import { workspaceLayout } from "../workspace-layout";
import { type ChatFoldersSwept, sweepChatFolders } from "./sweep";

/**
 * Gives every chat in the workspace its own folder and `CHAT.md`, as the app
 * does at each launch before anything opens a chat: the chats that already
 * had one at the update, and any a build left without one since.
 *
 * The topics are named as the workspace holds them, and the days and times
 * in this computer's own zone, which is the zone the person reading the
 * folder is in. Reads the folder rather than the workspace's own state, so it
 * runs before the workspace starts.
 */
export function giveChatsTheirFolders(
  rootDir: string,
  machineDir: string,
): Promise<ChatFoldersSwept> {
  return sweepChatFolders({
    chatsDir: workspaceLayout(rootDir).chatsDir,
    machineDir,
    rootDir,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    topicNames: new Map(
      readTopicsSync(rootDir).map((topic) => [topic.id, topic.name]),
    ),
  });
}
