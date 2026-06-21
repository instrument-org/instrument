import {
  type SubdomainPart,
} from "../../schemas/subdomain-part";
import {
  TaskIdSchema,
} from "../../schemas/task-id";
import {
  type WorkspaceConfig,
} from "../../types";
import {
  absolutePathJoin,
} from "../absolute-path-join";
import {
  generateNewFolderName,
} from "../generate-folder-name";
import {
  pathExists,
} from "../path-exists";
import {
  createAppConfig,
} from "./create";
import {
  type AppConfigProject,
} from "./types";

export async function newProjectConfig({
  preferredFolderName,
  workspaceConfig,
}: {
  preferredFolderName?: SubdomainPart;
  workspaceConfig: WorkspaceConfig;
}): Promise<AppConfigProject> {
  const rawSubdomain =
    preferredFolderName &&
    !(await pathExists(
      absolutePathJoin(workspaceConfig.projectsDir, preferredFolderName),
    ))
      ? preferredFolderName
      : await generateNewFolderName(workspaceConfig.projectsDir);

  return createAppConfig({
    subdomain: TaskIdSchema.parse(rawSubdomain),
  });
}
