import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { cappedTitle } from "./chat-folders/folder-name";
import { ChatWrites } from "./chat-writes";
import { isUntitledChatSessionTitle } from "./generate-session-title";
import { ChatReads } from "./chat-reads";
import { getWorkspaceConfig } from "./workspace-config";

export async function updateSessionTitle({
  expectedCurrentTitle,
  sessionId,
  chatId,
  title,
}: {
  // When set, replace only if the stored title still equals this. Callers that
  // set a title at creation pass it here so a user rename in the meantime is
  // never clobbered. Without it, only an untitled session's title is replaced.
  expectedCurrentTitle?: string;
  sessionId: StoreId.Session;
  chatId: ChatId;
  title: string;
}): Promise<boolean> {
  const storedSession = await ChatReads.session({ chatId, sessionId });
  if (storedSession.isErr()) {
    return false;
  }
  const canReplace =
    expectedCurrentTitle === undefined
      ? isUntitledChatSessionTitle(storedSession.value.title)
      : storedSession.value.title === expectedCurrentTitle;
  if (!canReplace) {
    return false;
  }
  const renameResult = await ChatWrites.saveSession(
    {
      ...storedSession.value,
      title: cappedTitle(title),
      updatedAt: new Date(),
    },
    chatId,
  );
  if (renameResult.isErr()) {
    getWorkspaceConfig().captureException(renameResult.error);
    return false;
  }
  return true;
}
