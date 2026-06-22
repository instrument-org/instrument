import { type Task } from "../schemas/task";
import { type TaskId } from "../schemas/task-id";
import { getTaskDirTimestamps } from "./get-task-dir-timestamps";
import { taskDir } from "./task-dir-utils";
import { assetBaseUrl } from "./url-for-subdomain";

export async function getTask(id: TaskId): Promise<Task> {
  const timestamps = await getTaskDirTimestamps(taskDir(id));

  return {
    assetBase: assetBaseUrl(id),
    createdAt: timestamps.createdAt,
    id,
    title: id,
    updatedAt: timestamps.updatedAt,
  };
}
