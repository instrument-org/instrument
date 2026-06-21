import path from "node:path";

import { AppDirSchema } from "../../schemas/paths";
import { type ProjectSubdomain } from "../../schemas/subdomains";
import { getWorkspaceConfig } from "../workspace-config";
import { type AppConfigProject } from "./types";

export function createAppConfig({
  subdomain,
}: {
  subdomain: ProjectSubdomain;
}): AppConfigProject {
  // For tasks the folder name is identical to the subdomain.
  return {
    appDir: AppDirSchema.parse(
      path.join(getWorkspaceConfig().projectsDir, subdomain),
    ),
    subdomain,
  };
}
