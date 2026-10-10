import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";
import { generateSessionTitle } from "./generate-session-title";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

export async function createSession({
  sessionId,
  signal,
  taskId,
}: {
  sessionId: StoreId.Session;
  signal?: AbortSignal;
  taskId: ChatId;
}) {
  const title = await generateSessionTitle({
    signal,
    taskId,
  });
  const now = new Date();
  const result = await Store.saveSession(
    {
      createdAt: now,
      id: sessionId,
      title,
      updatedAt: now,
    },
    taskId,
    { signal },
  );

  if (result.isOk()) {
    getWorkspaceConfig().captureEvent("session.created");
  }

  return result;
}
