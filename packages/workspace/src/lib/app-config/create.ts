import path from "node:path";

import { AppDirSchema } from "../../schemas/paths";
import { type ProjectSubdomain } from "../../schemas/subdomains";
import { type WorkspaceConfig } from "../../types";
import { type AppConfigProject } from "./types";

export function createAppConfig({
  subdomain,
  workspaceConfig,
}: {
  subdomain: ProjectSubdomain;
  workspaceConfig: WorkspaceConfig;
}): AppConfigProject {
  // For tasks the folder name is identical to the subdomain.
  return {
    appDir: AppDirSchema.parse(
      path.join(workspaceConfig.projectsDir, subdomain),
    ),
    folderName: subdomain,
    subdomain,
    type: "project",
    workspaceConfig,
  };
}
