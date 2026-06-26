import { type Task } from "../schemas/task";
import { type TaskId } from "../schemas/task-id";
import { getCurrentDate } from "./get-current-date";
import { getTasks } from "./get-tasks";
import { updateTaskSettings } from "./task-settings";
import { getWorkspaceConfig } from "./workspace-config";

// Pin state lives in each task's settings.json as `pinnedAt`, so it travels
// with the folder on rename and can't be inherited by a reused folder name.

export function addPin(id: TaskId) {
  return updateTaskSettings(id, { pinnedAt: getCurrentDate() });
}

export async function getPinnedTasks(): Promise<Task[]> {
  const { tasks } = await getTasks(getWorkspaceConfig());
  const pinned = tasks.filter((task) => task.pinnedAt !== undefined);
  return pinned.toSorted(
    (a, b) => (a.pinnedAt?.getTime() ?? 0) - (b.pinnedAt?.getTime() ?? 0),
  );
}

export async function getPins(): Promise<TaskId[]> {
  const pinned = await getPinnedTasks();
  return pinned.map((task) => task.id);
}

export function removePin(id: TaskId) {
  return updateTaskSettings(id, { pinnedAt: null });
}
