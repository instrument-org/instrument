import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { APP_FOLDER_NAMES } from "../constants";
import { type TaskId } from "../schemas/task-id";
import { type TaskManifestUpdate } from "../schemas/task-manifest";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { taskDir, templateExists } from "./app-dir-utils";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { updateTaskManifest } from "./task-manifest";

export async function initializeTask(
  {
    initialManifest,
    taskId,
    templateName,
    workspaceConfig,
  }: {
    initialManifest: Omit<TaskManifestUpdate, "createdWithAppVersion">;
    taskId: TaskId;
    templateName: string;
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

    const templateDir = absolutePathJoin(
      workspaceConfig.templatesDir,
      templateName,
    );

    const doesTemplateExist = await templateExists({
      folderName: templateName,
      workspaceConfig,
    });

    if (!doesTemplateExist) {
      return errAsync(
        new TypedError.NotFound(`Template does not exist: ${templateName}`),
      );
    }

    yield* copyTask({
      includePrivateFolder: false,
      isTemplate: true,
      sourceDir: templateDir,
      targetDir: taskDir(taskId),
    });

    yield* updateTaskManifest(taskId, {
      ...initialManifest,
      createdWithAppVersion: workspaceConfig.appVersion,
    });

    // Create standard directories so they appear in the file tree. Avoids agent
    // spending a tool call to create them.
    const standardDirs = [
      APP_FOLDER_NAMES.output,
      APP_FOLDER_NAMES.scripts,
      APP_FOLDER_NAMES.tmp,
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
