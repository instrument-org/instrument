import { type TaskId } from "../schemas/task-id";
import { getConnectorsDirIfInitialized } from "./connectors/paths";
import { taskDir } from "./task-dir-utils";
import { type TaskState } from "./task-state-store";
import {
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * The layout a tool call resolves paths against: the writable task mount,
 * the task's read-only /mnt attached folders, and the workspace /connectors
 * mount when the workspace is initialized.
 */
export function buildTaskFsLayout(
  taskId: TaskId,
  taskState: TaskState,
): WorkspaceFsLayout {
  return buildWorkspaceFsLayout({
    attachedFolders: taskState.attachedFolders,
    connectorsHostRoot: getConnectorsDirIfInitialized(),
    taskHostRoot: taskDir(taskId),
  });
}
