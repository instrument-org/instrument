import { publishedUntil } from "../../rpc/publisher";
import { sessionRole } from "../chat/children";
import { getWorkspaceConfig } from "../workspace-config";
import { rewriteChatFolder } from "./write-chat-folder";

/**
 * Writes a chat's `CHAT.md` each time one of its turns ends, so what a
 * person opens in the folder is the conversation as of the last time the
 * agent stopped.
 *
 * Every session's turn counts, a task's included, because a task's steps
 * are drawn in its parent's transcript and a chat whose task just finished
 * has a transcript that moved. Nothing is written when the bytes read the
 * same, which is the usual answer for a turn that only a task ran.
 */
export function startChatFolderWrites(signal?: AbortSignal): void {
  void (async () => {
    for await (const { id, sessionId } of publishedUntil(
      "session.done",
      signal,
    )) {
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
