import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { sessionRole } from "../chat/children";
import { readTopicsSync } from "../chat/topics";
import { getWorkspaceConfig } from "../workspace-config";
import { workspaceLayout } from "../workspace-layout";
import { writeChatFolder } from "./sweep";

/**
 * Writes a chat's `CHAT.md` each time one of its turns ends, so what a
 * person opens in the folder is the conversation as it stands rather than
 * as it stood at the last launch.
 *
 * Every session's turn counts, a task's included, because a task's steps
 * are drawn in its parent's transcript and a chat whose task just finished
 * has a transcript that moved. Nothing is written when the bytes read the
 * same, which is the usual answer for a turn that only a task ran.
 *
 * The renderer needs the topics by name and a zone to write the days in,
 * both read here rather than held, so a topic renamed between turns shows
 * under its new name on the next one.
 */
export function startChatFolderWrites(): void {
  void (async () => {
    for await (const { id, sessionId } of publisher.subscribe("session.done")) {
      try {
        // A task's own folder is its parent's; the chat is what has one.
        if (sessionRole(id, sessionId) === undefined) {
          continue;
        }
        await rewriteChatFolder(id);
      } catch (error) {
        getWorkspaceConfig().captureException(error);
      }
    }
  })();
}

/**
 * Writes the chat's folder and `CHAT.md` from its records as they stand now,
 * reporting a failure rather than throwing it.
 */
export async function rewriteChatFolder(id: ChatId): Promise<void> {
  const { rootDir, workspaceMachineDir } = getWorkspaceConfig();
  const written = await writeChatFolder({
    chatsDir: workspaceLayout(rootDir).chatsDir,
    id,
    machineDir: workspaceMachineDir,
    rootDir,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    topicNames: new Map(
      readTopicsSync(rootDir).map((topic) => [topic.id, topic.name]),
    ),
  });
  if (written.kind === "failed") {
    getWorkspaceConfig().captureException(
      new Error("Could not write a chat's transcript"),
      { chatId: id, data: { error: written.error } },
    );
  }
}
