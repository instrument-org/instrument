import { type AppDir } from "../../schemas/paths";
import { type ProjectSubdomain } from "../../schemas/subdomains";

// A minimal task handle: the subdomain (which is also the folder name) plus its
// resolved directory. Previews were removed, so there is no longer a union or a
// `type` discriminant, and WorkspaceConfig is read via getWorkspaceConfig()
// rather than carried here.
export type AppConfig = AppConfigProject;

export interface AppConfigProject {
  appDir: AppDir;
  subdomain: ProjectSubdomain;
}
