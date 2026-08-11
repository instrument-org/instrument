import { type AbsolutePath, type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { resolveExistingFilePath } from "./resolve-agent-path";
import { taskDir } from "./task-dir-utils";
import { resolveTaskProjectFolder } from "./task-project-folder";
import { getTaskState } from "./task-record";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * Host path for a file a task can reach: task-relative, the mount path of a
 * folder the user attached (`/mnt/<name>/...`), or the folder of the task's
 * project (`/project/...`). Null when the path resolves outside everything the
 * task has -- including the task's own private dir and a symlink leading out of
 * a mount -- so a caller can fail closed.
 *
 * Use wherever the main process acts on a path that came from the renderer: the
 * task directory is only part of what a task's files can live in, and a mount
 * path resolved against the task directory is a file that does not exist.
 */
export async function resolveWorkspaceFilePath({
  filePath,
  taskId,
}: {
  filePath: WorkspaceFilePath;
  taskId: TaskId;
}): Promise<AbsolutePath | null> {
  const taskHostRoot = taskDir(taskId);
  const taskState = await getTaskState(taskHostRoot);
  const resolved = resolveExistingFilePath({
    inputPath: filePath,
    layout: buildWorkspaceFsLayout({
      attachedFolders: taskState.attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(taskId),
      taskHostRoot,
    }),
  });

  return resolved.isErr() ? null : resolved.value.absolutePath;
}
