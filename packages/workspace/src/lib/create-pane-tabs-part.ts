import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./task-dir-utils";
import { getTaskState } from "./task-state-store";
import { getWorkspaceConfig } from "./workspace-config";

/**
 * What the pane has open, for the turn about to run.
 *
 * The restraint on an over-eager `show`: an agent that can see a file is
 * already on screen has no reason to open it again. Absent when the pane holds
 * nothing, since "nothing is open" is not worth a line in every turn of a task
 * where the panel is never used.
 */
export async function createPaneTabsPart({
  createdAt,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const { pane } = await getTaskState(taskDir(taskId));
    if (!pane || pane.tabs.length === 0) {
      return undefined;
    }

    return {
      data: { tabs: pane.tabs },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-paneTabs",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}
