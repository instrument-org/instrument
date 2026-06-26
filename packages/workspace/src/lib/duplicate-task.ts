import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
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

    const sourceExists = await pathExists(taskDir(sourceId));
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${taskDir(sourceId)}`,
        ),
      );
    }

    // Ensure the parent tasks dir exists (idempotent), then create the task
    // dir non-recursively so it acts as an atomic existence guard. With
    // deterministic date+slug names, two concurrent duplicates can both pass a
    // separate access check, so we rely on mkdir failing with EEXIST instead.
    yield* ResultAsync.fromPromise(
      fs.mkdir(workspaceConfig.tasksDir, { recursive: true }),
      (error) =>
        new TypedError.FileSystem(
          error instanceof Error ? error.message : "Unknown error",
          { cause: error },
        ),
    );
    yield* ResultAsync.fromPromise(
      fs.mkdir(taskDir(taskId), { recursive: false }),
      (error) =>
        error instanceof Error && "code" in error && error.code === "EEXIST"
          ? new TypedError.Conflict(
              `Task directory already exists: ${taskDir(taskId)}`,
            )
          : new TypedError.FileSystem(
              error instanceof Error ? error.message : "Unknown error",
              { cause: error },
            ),
    );

    yield* copyTask({
      includePrivateFolder: false,
      sourceDir: taskDir(sourceId),
      targetDir: taskDir(taskId),
    });

    const sourceSettings = await getTaskSettings(taskDir(sourceId));
    const sourceName = sourceSettings?.name || sourceId;
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
      createdWithAppVersion: sourceSettings?.createdWithAppVersion,
      name: duplicateName,
      projectId: sourceSettings?.projectId,
    });

    return ok({ taskId });
  });
}
