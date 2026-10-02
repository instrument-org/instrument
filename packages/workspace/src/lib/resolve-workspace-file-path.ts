import { type AbsolutePath, type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { WINDOW_ID } from "../schemas/window-id";
import { childTaskMounts } from "./chat/children";
import { folderReach } from "./chat/folder-reach";
import { resolveExistingFilePath } from "./resolve-agent-path";
import { taskDir } from "./task-dir-utils";
import { isChatId } from "./record-folders";
import {
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * Host path for a file a task can reach: task-relative, the mount path of a
 * folder the user attached (`/mnt/<name>/...`), or, for a chat, a task it
 * created (`/tasks/<id>/...`). Null when the path resolves outside everything the task
 * has -- including the task's own private dir and a symlink leading out of a
 * mount -- so a caller can fail closed.
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
  const resolved = await resolveWorkspaceFilePaths({
    filePaths: [filePath],
    taskId,
  });
  return resolved.get(filePath) ?? null;
}

/**
 * The same, for every path a surface is about to show at once, against one
 * reading of the task's layout: a transcript names many files and each
 * would otherwise cost a read of the task's record and settings.
 */
export async function resolveWorkspaceFilePaths({
  filePaths,
  taskId,
}: {
  filePaths: readonly WorkspaceFilePath[];
  taskId: TaskId;
}): Promise<Map<WorkspaceFilePath, AbsolutePath | null>> {
  const layout = await taskFsLayout(taskId);
  return new Map(
    filePaths.map((filePath) => {
      const resolved = resolveExistingFilePath({ inputPath: filePath, layout });
      return [filePath, resolved.isErr() ? null : resolved.value.absolutePath];
    }),
  );
}

/**
 * The filesystem a task's agent sees, as it stands now: its own folder, the
 * folders attached to it and, for a chat, the tasks it created. The window's is a chat's without a chat's own folders,
 * reaching every chat's tasks.
 */
export async function taskFsLayout(taskId: TaskId): Promise<WorkspaceFsLayout> {
  const taskHostRoot = taskDir(taskId);
  return buildWorkspaceFsLayout({
    attachedFolders: await folderReach(taskId),
    extraMounts:
      isChatId(taskId) || taskId === WINDOW_ID
        ? await childTaskMounts(taskId)
        : undefined,
    taskHostRoot,
  });
}
