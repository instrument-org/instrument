import { type AppDir } from "../../schemas/paths";
import { type ProjectSubdomain } from "../../schemas/subdomains";
import { type WorkspaceConfig } from "../../types";

// Previews were removed; an app config is always a project (task) config.
export type AppConfig = AppConfigProject;

export type AppConfigProject = AppConfigBase & {
  subdomain: ProjectSubdomain;
  type: "project";
};

interface AppConfigBase {
  appDir: AppDir;
  folderName: string;
  workspaceConfig: WorkspaceConfig;
}
