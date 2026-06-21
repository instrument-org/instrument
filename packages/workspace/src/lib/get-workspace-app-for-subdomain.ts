import { type WorkspaceAppProject } from "../schemas/app";
import { type AppSubdomain } from "../schemas/subdomains";
import { createAppConfig } from "./app-config/create";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getWorkspaceAppForSubdomain(
  subdomain: AppSubdomain,
): Promise<WorkspaceAppProject> {
  const appConfig = createAppConfig({ subdomain });

  const timestamps = await getAppDirTimestamps(appConfig.appDir);

  return {
    createdAt: timestamps.createdAt,
    folderName: appConfig.folderName,
    subdomain: appConfig.subdomain,
    title: appConfig.folderName,
    type: "project",
    updatedAt: timestamps.updatedAt,
    urls: urlsForSubdomain(appConfig.subdomain),
  };
}
