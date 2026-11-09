import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import { chatAttachmentsDir } from "../chat-dir-utils";
import { ChatReads } from "../chat-reads";
import { chatDir } from "../record-folders";
import { developerNotesWithBodies } from "../transcript/developer-notes";
import { getWorkspaceConfig } from "../workspace-config";
import { shellPath } from "../workspace-fs-layout";

/**
 * What a developer reads beside a session's transcript, from what is stored:
 * the whole session with no blob read back, and the paths a request names files
 * by, so a card reads as the request does.
 */
export function sessionDeveloperNotes({
  chatId,
  sessionId,
}: {
  chatId: ChatId;
  sessionId: StoreId.Session;
}) {
  return ChatReads.developerHistory({ chatId, sessionId }).map((messages) =>
    developerNotesWithBodies(messages, {
      attachmentsDir: shellPath(chatAttachmentsDir(chatDir(chatId))),
      sessionId,
      shellPath,
      workspaceRoot: getWorkspaceConfig().rootDir,
    }),
  );
}
