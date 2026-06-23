import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { TASK_FOLDER_NAMES } from "../constants";
import { type TaskId } from "../schemas/task-id";
import { type TaskSettingsUpdate } from "../schemas/task-settings";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { taskDir } from "./task-dir-utils";
import { updateTaskSettings } from "./task-settings";

export async function initializeTask(
  {
    initialManifest,
    taskId,
    workspaceConfig,
  }: {
    initialManifest: Omit<TaskSettingsUpdate, "createdWithAppVersion">;
    taskId: TaskId;
    workspaceConfig: WorkspaceConfig;
  },
  _options: { signal?: AbortSignal },
) {
  return safeTry(async function* () {
    // Ensure no folder exists
    const exists = await fs
      .access(taskDir(taskId))
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDir(taskId)}`,
        ),
      );
    }
    yield* ResultAsync.fromPromise(
      fs.mkdir(taskDir(taskId), { recursive: true }),
      (error) =>
        new TypedError.FileSystem(
          error instanceof Error ? error.message : "Unknown error",
          { cause: error },
        ),
    );

    yield* copyTask({
      includePrivateFolder: false,
      sourceDir: workspaceConfig.defaultTaskTemplateDir,
      targetDir: taskDir(taskId),
    });

    yield* updateTaskSettings(taskId, {
      ...initialManifest,
      createdWithAppVersion: workspaceConfig.appVersion,
    });

    // Create standard directories so they appear in the file tree. Avoids agent
    // spending a tool call to create them.
    const standardDirs = [
      TASK_FOLDER_NAMES.output,
      TASK_FOLDER_NAMES.scripts,
      TASK_FOLDER_NAMES.tmp,
    ];
    for (const dirName of standardDirs) {
      yield* ResultAsync.fromPromise(
        fs.mkdir(absolutePathJoin(taskDir(taskId), dirName), {
          recursive: true,
        }),
        (error) =>
          new TypedError.FileSystem(
            error instanceof Error ? error.message : "Unknown error",
            { cause: error },
          ),
      );
    }

    return ok({ taskId });
  });
}
