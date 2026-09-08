import { ulid } from "ulid";

import { publisher } from "../rpc/publisher";
import { FolderAttachment } from "../schemas/folder-attachment";
import { AbsolutePathSchema } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { assignMountNames } from "./assign-mount-names";
import { getCurrentDate } from "./get-current-date";
import { taskDir } from "./task-dir-utils";
import { getTaskState, setTaskState } from "./task-record";

/**
 * Attach a folder to a task outside of a message, the way an answered
 * `request_folder` does. A path already attached is re-granted with the access
 * given rather than mounted twice, the same rule the message path follows, and
 * the mount name is assigned beside the folders already there so it is unique
 * within the task.
 */
export async function attachFolder({
  access,
  path,
  taskId,
}: {
  access: FolderAttachment.Access;
  path: string;
  taskId: TaskId;
}): Promise<FolderAttachment.Type> {
  const dir = taskDir(taskId);
  const state = await getTaskState(dir);
  const existing = Object.values(state.attachedFolders ?? {});
  const folderPath = AbsolutePathSchema.parse(path);

  const matched = existing.find((folder) => folder.path === folderPath);
  const folders = matched
    ? existing.map((folder) =>
        folder === matched ? { ...folder, access } : folder,
      )
    : [
        ...existing,
        {
          access,
          createdAt: getCurrentDate().getTime(),
          id: FolderAttachment.IdSchema.parse(ulid()),
          mountName: "",
          path: folderPath,
          source: "user" as const,
        },
      ];

  const sorted = folders.toSorted((a, b) => a.createdAt - b.createdAt);
  const names = assignMountNames(sorted);
  const next: Record<string, FolderAttachment.Type> = {};
  for (const folder of sorted) {
    const mountName = names.get(folder.id) ?? folder.mountName;
    next[mountName] = { ...folder, mountName };
  }
  await setTaskState(dir, { attachedFolders: next });
  publisher.publish("task.updated", { id: taskId });

  const attached = Object.values(next).find(
    (folder) => folder.path === folderPath,
  );
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
  publisher.publish("task.updated", { id: taskId });
}
