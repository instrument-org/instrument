import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./task-dir-utils";
import { type TaskState } from "./task-state-store";
import {
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * The layout a tool call resolves paths against, from the task's own state:
 * the writable task mount, the workspace's writable mounts, and the task's
 * read-only /mnt attached folders.
 */
export function buildTaskFsLayout(
  taskId: TaskId,
  taskState: TaskState,
): WorkspaceFsLayout {
  return buildWorkspaceFsLayout({
    attachedFolders: taskState.attachedFolders,
    taskHostRoot: taskDir(taskId),
  });
}
