import { type AbsolutePath, type WorkspaceFilePath } from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { folderReach } from "./chat/folder-reach";
import { resolveExistingFilePath } from "./resolve-agent-path";
import {
  buildWorkspaceFsLayout,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";
import { workDir } from "./work-dir";

/**
 * Host path for a file a task can reach: task-relative, or the mount path of a
 * folder the user attached (`/mnt/<name>/...`). Null when the path resolves outside everything the task
 * has -- including the task's own private dir and a symlink leading out of a
 * mount -- so a caller can fail closed.
 *
 * Use wherever the main process acts on a path that came from the renderer: the
 * task directory is only part of what a task's files can live in, and a mount
 * path resolved against the task directory is a file that does not exist.
 */
export async function resolveWorkspaceFilePath({
  filePath,
  chatId,
}: {
  filePath: WorkspaceFilePath;
  chatId: ChatId;
}): Promise<AbsolutePath | null> {
  const resolved = await resolveWorkspaceFilePaths({
    filePaths: [filePath],
    chatId,
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
  chatId,
}: {
  filePaths: readonly WorkspaceFilePath[];
  chatId: ChatId;
}): Promise<Map<WorkspaceFilePath, AbsolutePath | null>> {
  const layout = await taskFsLayout(chatId);
  return new Map(
    filePaths.map((filePath) => {
      const resolved = resolveExistingFilePath({ inputPath: filePath, layout });
      return [filePath, resolved.isErr() ? null : resolved.value.absolutePath];
    }),
  );
}

/**
 * The filesystem a task's agent sees, as it stands now: its own folder and
 * the folders attached to it.
 */
export async function taskFsLayout(chatId: ChatId): Promise<WorkspaceFsLayout> {
  return buildWorkspaceFsLayout({
    attachedFolders: await folderReach(chatId),
    taskHostRoot: workDir(chatId),
  });
}
