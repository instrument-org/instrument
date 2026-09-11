import { type AbsolutePath, type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { childTaskMounts } from "./orchestrator/children";
import { resolveExistingFilePath } from "./resolve-agent-path";
import { taskDir } from "./task-dir-utils";
import { resolveTaskProjectFolder } from "./task-project-folder";
import { getTaskState } from "./task-record";
import { getTaskSettings } from "./task-settings";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * Host path for a file a task can reach: task-relative, the mount path of a
 * folder the user attached (`/mnt/<name>/...`), the folder of the task's
 * project (`/project/...`), or, for an orchestrator, a task it created
 * (`/tasks/<id>/...`). Null when the path resolves outside everything the task
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
  const taskHostRoot = taskDir(taskId);
  const taskState = await getTaskState(taskHostRoot);
  const settings = await getTaskSettings(taskHostRoot);
  const layout = buildWorkspaceFsLayout({
    attachedFolders: taskState.attachedFolders,
    extraMounts:
      settings?.kind === "orchestrator"
        ? await childTaskMounts(taskId)
        : undefined,
    projectFolderName: await resolveTaskProjectFolder(taskId),
    taskHostRoot,
  });
  return new Map(
    filePaths.map((filePath) => {
      const resolved = resolveExistingFilePath({ inputPath: filePath, layout });
      return [filePath, resolved.isErr() ? null : resolved.value.absolutePath];
    }),
  );
}
