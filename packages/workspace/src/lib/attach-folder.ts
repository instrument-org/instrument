import { type FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { getCurrentDate } from "./get-current-date";
import { grantFolders } from "./grant-folders";
import { taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-record";

/**
 * Attach a folder to a task outside of a message, the way an answered
 * `request_folder` or `task folder --add` does. A path already attached is
 * re-granted with the access given rather than mounted twice, the same rule
 * the message path follows. It mounts under `mountName` where one is given
 * and free, which is how a chat's task reaches a folder at the chat's own path
 * for it, and otherwise under a name assigned beside the folders already
 * there.
 */
export async function attachFolder({
  access,
  mountName,
  path,
  taskId,
}: {
  access: FolderAttachment.Access;
  mountName?: string;
  path: string;
  taskId: TaskId;
}): Promise<FolderAttachment.Type> {
  const dir = taskDir(taskId);
  const state = await getTaskState(dir);
  const { folders, granted } = grantFolders(
    Object.values(state.attachedFolders ?? {}),
    [
      {
        access,
        ...(mountName ? { mountName } : {}),
        path: AbsolutePathSchema.parse(path),
        source: "user",
      },
    ],
    getCurrentDate().getTime(),
  );
  await setTaskState(dir, { attachedFolders: folders });
  const [attached] = granted;
  if (!attached) {
    throw new Error(`Folder ${path} was not attached`);
  }
  return attached;
}

/**
 * Take a folder away from a task, by the folder on disk rather than by the id
 * the panel holds. The mirror of {@link attachFolder}, for the callers that
 * know a path and not an attachment.
 *
 * The mounts left keep the names they had. A name is only meaningful against
 * the set that assigned it, and reassigning here would move a folder the agent
 * is midway through working in out from under the path it last read.
 */
export async function detachFolder({
  path: folderPath,
  taskId,
}: {
  path: string;
  taskId: TaskId;
}): Promise<void> {
  const dir = taskDir(taskId);
  const state = await getTaskState(dir);
  const wanted = AbsolutePathSchema.parse(folderPath);
  const remaining = Object.entries(state.attachedFolders ?? {}).filter(
    ([, folder]) => folder.path !== wanted,
  );
  await setTaskState(dir, { attachedFolders: Object.fromEntries(remaining) });
}
