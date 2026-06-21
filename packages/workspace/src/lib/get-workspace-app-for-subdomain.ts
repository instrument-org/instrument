import { type WorkspaceAppProject } from "../schemas/app";
import { type AppSubdomain } from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import { urlsForSubdomain } from "./url-for-subdomain";

export async function getWorkspaceAppForSubdomain(
  subdomain: AppSubdomain,
  workspaceConfig: WorkspaceConfig,
): Promise<WorkspaceAppProject> {
  const appConfig = createAppConfig({ subdomain, workspaceConfig });

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
