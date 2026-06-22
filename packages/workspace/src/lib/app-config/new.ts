import { type SubdomainPart } from "../../schemas/subdomain-part";
import { TaskIdSchema } from "../../schemas/task-id";
import { type WorkspaceConfig } from "../../types";
import { absolutePathJoin } from "../absolute-path-join";
import { generateNewFolderName } from "../generate-folder-name";
import { pathExists } from "../path-exists";
import { createAppConfig } from "./create";
import { type AppConfigProject } from "./types";

export async function newProjectConfig({
  preferredFolderName,
  workspaceConfig,
}: {
  preferredFolderName?: SubdomainPart;
  workspaceConfig: WorkspaceConfig;
}): Promise<AppConfigProject> {
  const rawId =
    preferredFolderName &&
    !(await pathExists(
      absolutePathJoin(workspaceConfig.tasksDir, preferredFolderName),
    ))
      ? preferredFolderName
      : await generateNewFolderName(workspaceConfig.tasksDir);

  return createAppConfig({
    id: TaskIdSchema.parse(rawId),
  });
}
