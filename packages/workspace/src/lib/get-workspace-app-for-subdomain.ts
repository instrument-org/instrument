import {
  type WorkspaceAppProject,
} from "../schemas/app";
import {
  type TaskId,
} from "../schemas/task-id";
import {
  createAppConfig,
} from "./app-config/create";
import {
  taskDir,
} from "./app-dir-utils";
import {
  getAppDirTimestamps,
} from "./get-app-dir-timestamps";
import {
  urlsForSubdomain,
} from "./url-for-subdomain";

export async function getWorkspaceAppForSubdomain(
  subdomain: TaskId,
): Promise<WorkspaceAppProject> {
  const appConfig = createAppConfig({ subdomain });

  const timestamps = await getAppDirTimestamps(taskDir(appConfig));

  return {
    createdAt: timestamps.createdAt,
    folderName: appConfig,
    subdomain: appConfig,
    title: appConfig,
    type: "project",
    updatedAt: timestamps.updatedAt,
    urls: urlsForSubdomain(appConfig),
  };
}
