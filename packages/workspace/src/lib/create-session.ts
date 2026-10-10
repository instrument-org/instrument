import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { generateSessionTitle } from "./generate-session-title";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

export async function createSession({
  sessionId,
  signal,
  chatId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  chatId: ChatId;
}) {
  const title = await generateSessionTitle({
    signal,
    chatId,
  });
  const now = new Date();
  const result = await Store.saveSession(
    {
      createdAt: now,
      id: sessionId,
      title,
      updatedAt: now,
    },
    chatId,
    { signal },
  );

  if (result.isOk()) {
    getWorkspaceConfig().captureEvent("session.created");
  }

  return result;
}
