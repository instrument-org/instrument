import { type WorkspaceAppProject } from "../schemas/app";
import { type AppSubdomain } from "../schemas/subdomains";
import { createAppConfig } from "./app-config/create";
import { taskDir } from "./app-dir-utils";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getWorkspaceAppForSubdomain(
  subdomain: AppSubdomain,
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
