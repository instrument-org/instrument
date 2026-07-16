import { ok, ResultAsync, safeTry } from "neverthrow";
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
    initialSettings,
    taskId,
    workspaceConfig,
  }: {
    initialSettings: Omit<TaskSettingsUpdate, "createdWithAppVersion">;
    taskId: TaskId;
    workspaceConfig: WorkspaceConfig;
  },
  _options: { signal?: AbortSignal },
) {
  return safeTry(async function* () {
    // Ensure the parent tasks dir exists (idempotent), then create the task
    // dir non-recursively so it acts as an atomic existence guard. With
    // deterministic date+slug names, two concurrent creates can both pass a
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
      sourceDir: workspaceConfig.defaultTaskTemplateDir,
      targetDir: taskDir(taskId),
    });

    yield* updateTaskSettings(taskId, {
      ...initialSettings,
      createdWithAppVersion: workspaceConfig.appVersion,
    });

    // Create standard directories so they appear in the file tree. Avoids agent
    // spending a tool call to create them. `work` normally arrives via the
    // template copy above; creating it here too makes the agent-visible triad
    // a guarantee of task initialization rather than a template detail (venv
    // creation, pnpm guidance, and skill installs all assume it exists).
    const standardDirs = [
      TASK_FOLDER_NAMES.output,
      TASK_FOLDER_NAMES.attachments,
      TASK_FOLDER_NAMES.work,
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
