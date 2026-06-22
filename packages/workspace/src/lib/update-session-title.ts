import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { isSessionTitleAutoReplaceable } from "./generate-session-title";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

export async function updateSessionTitle({
  sessionId,
  taskId,
  title,
}: {
  sessionId: StoreId.Session;
  taskId: TaskId;
  title: string;
}) {
  const storedSession = await Store.getSession(sessionId, taskId);
  if (storedSession.isErr()) {
    return;
  }
  const canReplace = await isSessionTitleAutoReplaceable({
    taskId,
    title: storedSession.value.title,
  });
  if (!canReplace) {
    return;
  }
  const renameResult = await Store.saveSession(
    {
      ...storedSession.value,
      title,
      updatedAt: new Date(),
    },
    taskId,
  );
  if (renameResult.isErr()) {
    getWorkspaceConfig().captureException(renameResult.error);
  }
}
