import { type AppDir } from "../../schemas/paths";
import {
  type PreviewSubdomain,
  type ProjectSubdomain,
} from "../../schemas/subdomains";
import { type WorkspaceConfig } from "../../types";

export type AppConfig = AppConfigPreview | AppConfigProject;

export type AppConfigPreview = AppConfigBase & {
  subdomain: PreviewSubdomain;
  type: "preview";
};

export type AppConfigProject = AppConfigBase & {
  subdomain: ProjectSubdomain;
  type: "project";
};

interface AppConfigBase {
  appDir: AppDir;
  folderName: string;
  workspaceConfig: WorkspaceConfig;
}
