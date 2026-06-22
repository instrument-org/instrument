import { errAsync, ok, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { getTaskPrivateDir, sessionStorePath, taskDir } from "./app-dir-utils";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { newTaskId } from "./new-task-id";
import { pathExists } from "./path-exists";
import { getTaskManifest, updateTaskManifest } from "./task-manifest";
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

    const sourceManifest = await getTaskManifest(taskDir(sourceId));
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
      // Preserve only the selected model from the source project
      if (sourceTaskState.selectedModelURI) {
        await setTaskState(taskDir(taskId), {
          selectedModelURI: sourceTaskState.selectedModelURI,
        });
      }
    }

    const existingManifest = await getTaskManifest(taskDir(taskId));

    yield* updateTaskManifest(taskId, {
      ...(existingManifest && { iconName: existingManifest.iconName }),
      name: duplicateName,
    });

    return ok({ taskId });
  });
}
