import { type Task } from "../schemas/app";
import { type TaskId } from "../schemas/task-id";
import { createAppConfig } from "./app-config/create";
import { taskDir } from "./app-dir-utils";
import { getTaskDirTimestamps } from "./get-app-dir-timestamps";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getTask(id: TaskId): Promise<Task> {
  const appConfig = createAppConfig({ id });

  const timestamps = await getTaskDirTimestamps(taskDir(appConfig));

  return {
    createdAt: timestamps.createdAt,
    folderName: appConfig,
    id: appConfig,
    title: appConfig,
    type: "project",
    updatedAt: timestamps.updatedAt,
    urls: urlsForSubdomain(appConfig),
  };
}
