import { type Task } from "../schemas/app";
import { type TaskId } from "../schemas/task-id";
import { taskDir } from "./app-dir-utils";
import { getTaskDirTimestamps } from "./get-app-dir-timestamps";
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
