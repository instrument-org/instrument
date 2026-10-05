import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { taskDir } from "../../lib/task-dir-utils";
import { buildWorkspaceFsLayout } from "../../lib/workspace-fs-layout";

/** The layout a task's shell has, with the folders given mounted beside it. */
export function taskLayout(
  taskId: TaskId,
  attachedFolders?: Record<string, FolderAttachment.Type>,
) {
  return buildWorkspaceFsLayout({
    ...(attachedFolders ? { attachedFolders } : {}),
    taskHostRoot: taskDir(taskId),
  });
}
