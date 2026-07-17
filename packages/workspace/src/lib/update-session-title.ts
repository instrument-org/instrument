import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { isSessionTitleAutoReplaceable } from "./generate-session-title";
import { Store } from "./store";
import { getWorkspaceConfig } from "./workspace-config";

export async function updateSessionTitle({
  expectedCurrentTitle,
  sessionId,
  taskId,
  title,
}: {
  // When set, replace only if the stored title still equals this. Callers that
  // set a title at creation pass it here so a user rename in the meantime is
  // never clobbered: the rename keeps settings.name and the title in sync, so
  // isSessionTitleAutoReplaceable can't tell it apart from the default.
  expectedCurrentTitle?: string;
  sessionId: StoreId.Session;
  taskId: TaskId;
  title: string;
}): Promise<boolean> {
  const storedSession = await Store.getSession(sessionId, taskId);
  if (storedSession.isErr()) {
    return false;
  }
  const canReplace =
    expectedCurrentTitle === undefined
      ? await isSessionTitleAutoReplaceable({
          taskId,
          title: storedSession.value.title,
        })
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
    taskId,
  );
  if (renameResult.isErr()) {
    getWorkspaceConfig().captureException(renameResult.error);
    return false;
  }
  return true;
}
