import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { generateSessionTitle } from "./generate-session-title";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

export async function createSession({
  parentSessionId,
  sessionId,
  sessionNamePrefix,
  signal,
  taskId,
}: {
  parentSessionId?: StoreId.Session;
  sessionId: StoreId.Session;
  sessionNamePrefix?: string;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  const title = await generateSessionTitle({
    sessionNamePrefix,
    signal,
    taskId,
  });
  const now = new Date();
  const result = await Store.saveSession(
    {
      ...(parentSessionId ? { parentId: parentSessionId } : {}),
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
