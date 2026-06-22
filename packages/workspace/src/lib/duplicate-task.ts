import { errAsync, ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { newTaskId } from "./new-task-id";
import { pathExists } from "./path-exists";
import { getTaskPrivateDir, sessionStorePath, taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";
import { getTaskState, setTaskState } from "./task-state-store";

interface DuplicateTaskOptions {
  keepHistory: boolean;
  sourceTaskId: TaskId;
  workspaceConfig: WorkspaceConfig;
}

export async function duplicateTask(
  { keepHistory, sourceTaskId, workspaceConfig }: DuplicateTaskOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const sourceId = sourceTaskId;

    const taskId = await newTaskId({
      workspaceConfig,
    });

    const taskExists = await pathExists(taskDir(taskId));
    if (taskExists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDir(taskId)}`,
        ),
      );
    }

    const sourceExists = await pathExists(taskDir(sourceId));
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${taskDir(sourceId)}`,
        ),
      );
    }

    yield* copyTask({
      includePrivateFolder: false,
      isTemplate: false,
      sourceDir: taskDir(sourceId),
      targetDir: taskDir(taskId),
    });

    const sourceManifest = await getTaskSettings(taskDir(sourceId));
    const sourceName = sourceManifest?.name || sourceId;
    const duplicateName = `Copy of ${sourceName}`;

    const sourceTaskState = await getTaskState(taskDir(sourceId));

    if (keepHistory) {
      const sourceSessionDbPath = sessionStorePath(taskDir(sourceId));
      const targetSessionDbPath = sessionStorePath(taskDir(taskId));

      if (await pathExists(sourceSessionDbPath)) {
        const targetPrivateDir = getTaskPrivateDir(taskDir(taskId));
        await fs.mkdir(targetPrivateDir, { recursive: true });
        await fs.copyFile(sourceSessionDbPath, targetSessionDbPath);
      }

      await setTaskState(taskDir(taskId), sourceTaskState);
    } else {
      // Preserve only the selected model from the source task
      if (sourceTaskState.selectedModelURI) {
        await setTaskState(taskDir(taskId), {
          selectedModelURI: sourceTaskState.selectedModelURI,
        });
      }
    }

    yield* updateTaskSettings(taskId, {
      name: duplicateName,
    });

    return ok({ taskId });
  });
}
