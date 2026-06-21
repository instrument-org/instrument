import { type AppDir } from "../../schemas/paths";
import { type ProjectSubdomain } from "../../schemas/subdomains";

// Previews were removed; an app config is always a project (task) config.
// WorkspaceConfig is no longer carried here — read it via getWorkspaceConfig().
export type AppConfig = AppConfigProject;

export type AppConfigProject = AppConfigBase & {
  subdomain: ProjectSubdomain;
  type: "project";
};

interface AppConfigBase {
  appDir: AppDir;
  folderName: string;
}
