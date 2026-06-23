import { type SubdomainPart } from "../schemas/subdomain-part";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { generateTaskFolderName } from "./generate-task-folder-name";
import { pathExists } from "./path-exists";

export async function newTaskId({
  preferredFolderName,
  prompt,
  workspaceConfig,
}: {
  preferredFolderName?: SubdomainPart;
  prompt?: string;
  workspaceConfig: WorkspaceConfig;
}): Promise<TaskId> {
  if (
    preferredFolderName &&
    !(await pathExists(
      absolutePathJoin(workspaceConfig.tasksDir, preferredFolderName),
    ))
  ) {
    return TaskIdSchema.parse(preferredFolderName);
  }

  const rawId = await generateTaskFolderName({
    prompt,
    tasksDir: workspaceConfig.tasksDir,
  });

  return TaskIdSchema.parse(rawId);
}
