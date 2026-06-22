import { type SubdomainPart } from "../schemas/subdomain-part";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { generateNewFolderName } from "./generate-folder-name";
import { pathExists } from "./path-exists";

export async function newTaskId({
  preferredFolderName,
  workspaceConfig,
}: {
  preferredFolderName?: SubdomainPart;
  workspaceConfig: WorkspaceConfig;
}): Promise<TaskId> {
  const rawId =
    preferredFolderName &&
    !(await pathExists(
      absolutePathJoin(workspaceConfig.tasksDir, preferredFolderName),
    ))
      ? preferredFolderName
      : await generateNewFolderName(workspaceConfig.tasksDir);

  return TaskIdSchema.parse(rawId);
}
