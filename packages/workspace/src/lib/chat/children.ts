import path from "node:path";

import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type ChatId } from "../../schemas/chat-id";
import { type TaskDir } from "../../schemas/paths";
import { type TaskInChat } from "../../schemas/task";
import { type TaskId } from "../../schemas/task-id";
import { getTasksIn } from "../get-tasks";
import { chatTaskDirs, chatTaskIds } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { type WorkspaceFsMount } from "../workspace-fs-layout";

/**
 * One read-only mount per child at `/tasks/<id>`, with the child's private
 * directory masked the way its own agent's view of it is. The chat
 * reads a child's scratch and output to see what it made, and never writes
 * there: a child's folder is the child's, and a transcript is read through
 * `task log`, which renders it from the store rather than opening the file.
 */
export async function childTaskMounts(
  chatId: ChatId,
): Promise<WorkspaceFsMount[]> {
  return taskMounts(chatTaskIds(chatId).map((id) => taskDir(id)));
}

/**
 * The tasks a chat started, newest activity first, each read only when
 * `which` takes its id. Anything that is not a chat has none: no id stands
 * for every chat's tasks.
 */
export async function listChildTasks(
  chatId: ChatId,
  which: (id: TaskId) => boolean = () => true,
): Promise<TaskInChat[]> {
  const tasks = await getTasksIn(
    chatTaskIds(chatId)
      .filter((id) => which(id))
      .map((id) => taskDir(id)),
    { direction: "desc", sortBy: "updatedAt" },
  );
  return tasks.filter((task): task is TaskInChat => !task.isChat);
}

/**
 * The same mounts for the window, which no chat is: every chat's task
 * folder by where the folder index has it, so a `/tasks/<id>` path the
 * window was handed opens wherever it came from. Read from the index alone;
 * no task's record is read.
 */
export function windowTaskMounts(): WorkspaceFsMount[] {
  return taskMounts(chatTaskDirs());
}

function taskMounts(dirs: TaskDir[]): WorkspaceFsMount[] {
  return dirs.map((dir) => ({
    hostRoot: dir,
    maskedEntries: [TASK_FOLDER_NAMES.private],
    mountPoint: `${MOUNT.tasks}/${path.basename(dir)}`,
    readOnly: true,
  }));
}
