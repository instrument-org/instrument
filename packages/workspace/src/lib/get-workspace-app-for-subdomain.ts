import {
  type WorkspaceApp,
  type WorkspaceAppPreview,
  type WorkspaceAppProject,
} from "../schemas/app";
import {
  type AppSubdomain,
  type PreviewSubdomain,
  type ProjectSubdomain,
} from "../schemas/subdomains";
import { type WorkspaceConfig } from "../types";
import { createAppConfig } from "./app-config/create";
import { getAppDirTimestamps } from "./get-app-dir-timestamps";
import { urlsForSubdomain } from "./url-for-subdomain";

type GetWorkspaceAppResult<T extends AppSubdomain> = T extends PreviewSubdomain
  ? WorkspaceAppPreview
  : T extends ProjectSubdomain
    ? WorkspaceAppProject
    : WorkspaceApp;

export async function getWorkspaceAppForSubdomain<T extends AppSubdomain>(
  subdomain: T,
  workspaceConfig: WorkspaceConfig,
): Promise<GetWorkspaceAppResult<T>> {
  const appConfig = createAppConfig({ subdomain, workspaceConfig });

  const timestamps = await getAppDirTimestamps(appConfig.appDir);

  const baseApp: Omit<WorkspaceApp, "project" | "subdomain"> = {
    createdAt: timestamps.createdAt,
    folderName: appConfig.folderName,
    title: appConfig.folderName,
    type: appConfig.type,
    updatedAt: timestamps.updatedAt,
    urls: urlsForSubdomain(appConfig.subdomain),
  };

  if (appConfig.type === "preview") {
    return {
      ...baseApp,
      subdomain: appConfig.subdomain,
      type: "preview",
    } satisfies WorkspaceAppPreview as unknown as GetWorkspaceAppResult<T>;
  }

  return {
    ...baseApp,
    subdomain: appConfig.subdomain,
    title: appConfig.folderName,
    type: appConfig.type,
    urls: urlsForSubdomain(appConfig.subdomain),
  } satisfies WorkspaceAppProject as unknown as GetWorkspaceAppResult<T>;
}
