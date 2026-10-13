import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { isUntitledChatSessionTitle } from "./generate-session-title";
import { Store } from "./store";
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
  const storedSession = await Store.getSession(sessionId, chatId);
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
  const renameResult = await Store.saveSession(
    {
      ...storedSession.value,
      title,
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
