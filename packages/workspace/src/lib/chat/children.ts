import { TASK_FOLDER_NAMES } from "../../constants";
import { MOUNT } from "../../mount-points";
import { type Task } from "../../schemas/task";
import { type TaskId } from "../../schemas/task-id";
import { getTasks } from "../get-tasks";
import { isChatId } from "../record-folders";
import { taskDir } from "../task-dir-utils";
import { getTaskSettings } from "../task-settings";
import { getWorkspaceConfig } from "../workspace-config";
import { type WorkspaceFsMount } from "../workspace-fs-layout";

/**
 * One read-only mount per child at `/tasks/<id>`, with the child's private
 * directory masked the way its own agent's view of it is. The chat
 * reads a child's scratch and output to see what it made, and never writes
 * there: a child's folder is the child's, and a transcript is read through
 * `task log`, which renders it from the store rather than opening the file.
 */
export async function childTaskMounts(
  chatId: TaskId,
): Promise<WorkspaceFsMount[]> {
  const children = await listChildTasks(chatId);
  return children.map((child) => ({
    hostRoot: taskDir(child.id),
    maskedEntries: [TASK_FOLDER_NAMES.private],
    mountPoint: `${MOUNT.tasks}/${child.id}`,
    readOnly: true,
  }));
}

/**
 * The tasks a record started, newest activity first. Asked of the window's
 * own record, every chat's tasks: the window shows all of them, and a path
 * into any of them opens from it.
 */
export async function listChildTasks(chatId: TaskId): Promise<Task[]> {
  const { tasks } = await getTasks(getWorkspaceConfig(), {
    direction: "desc",
    sortBy: "updatedAt",
  });
  const settings = await getTaskSettings(taskDir(chatId));
  const everyChat = !isChatId(chatId) && settings?.kind === "chat";
  return tasks.filter(
    (task) =>
      task.parentTaskId === chatId ||
      (everyChat &&
        task.parentTaskId !== undefined &&
        isChatId(task.parentTaskId)),
  );
}
