import { errAsync, ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { getTaskPrivateDir, sessionStorePath, taskDir } from "./app-dir-utils";
import { copyProject } from "./copy-project";
import { TypedError } from "./errors";
import { newTaskId } from "./new-task-id";
import { pathExists } from "./path-exists";
import { getProjectManifest, updateProjectManifest } from "./project-manifest";
import { getProjectState, setProjectState } from "./project-state-store";

interface DuplicateProjectOptions {
  keepHistory: boolean;
  sourceTaskId: TaskId;
  workspaceConfig: WorkspaceConfig;
}

export async function duplicateProject(
  { keepHistory, sourceTaskId, workspaceConfig }: DuplicateProjectOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const sourceConfig = sourceTaskId;

    const taskId = await newTaskId({
      workspaceConfig,
    });

    const projectExists = await pathExists(taskDir(taskId));
    if (projectExists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDir(taskId)}`,
        ),
      );
    }

    const sourceExists = await pathExists(taskDir(sourceConfig));
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${taskDir(sourceConfig)}`,
        ),
      );
    }

    yield* copyProject({
      includePrivateFolder: false,
      isTemplate: false,
      sourceDir: taskDir(sourceConfig),
      targetDir: taskDir(taskId),
    });

    const sourceManifest = await getProjectManifest(taskDir(sourceConfig));
    const sourceName = sourceManifest?.name || sourceConfig;
    const duplicateName = `Copy of ${sourceName}`;

    const sourceProjectState = await getProjectState(taskDir(sourceConfig));

    if (keepHistory) {
      const sourceSessionDbPath = sessionStorePath(taskDir(sourceConfig));
      const targetSessionDbPath = sessionStorePath(taskDir(taskId));

      if (await pathExists(sourceSessionDbPath)) {
        const targetPrivateDir = getTaskPrivateDir(taskDir(taskId));
        await fs.mkdir(targetPrivateDir, { recursive: true });
        await fs.copyFile(sourceSessionDbPath, targetSessionDbPath);
      }

      await setProjectState(taskDir(taskId), sourceProjectState);
    } else {
      // Preserve only the selected model from the source project
      if (sourceProjectState.selectedModelURI) {
        await setProjectState(taskDir(taskId), {
          selectedModelURI: sourceProjectState.selectedModelURI,
        });
      }
    }

    const existingManifest = await getProjectManifest(taskDir(taskId));

    yield* updateProjectManifest(taskId, {
      ...(existingManifest && { iconName: existingManifest.iconName }),
      name: duplicateName,
    });

    return ok({ taskId });
  });
}
