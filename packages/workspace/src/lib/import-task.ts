import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import { ulid } from "ulid";

import { TaskDirSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { extractTaskZip } from "./extract-task-zip";
import { pathExists } from "./path-exists";

interface ImportTaskOptions {
  workspaceConfig: WorkspaceConfig;
  zipFileData: string;
}

export async function importTask(
  { workspaceConfig, zipFileData }: ImportTaskOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const id = TaskIdSchema.parse(`import-${ulid().toLowerCase()}`);

    // For tasks the folder name is identical to the id.
    const taskDirPath = TaskDirSchema.parse(
      absolutePathJoin(workspaceConfig.tasksDir, id),
    );

    const taskExists = await pathExists(taskDirPath);
    if (taskExists) {
      return errAsync(
        new TypedError.Conflict(
          `Task directory already exists: ${taskDirPath}`,
        ),
      );
    }

    yield* ResultAsync.fromPromise(
      extractTaskZip({
        outputDir: taskDirPath,
        zipBlob: new Blob([Buffer.from(zipFileData, "base64")]),
      }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to extract zip file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return ok({ taskId: id });
  });
}
