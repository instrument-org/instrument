import { ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";
import { ulid } from "ulid";

import { TaskDirSchema } from "../schemas/paths";
import { TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { extractTaskZip } from "./extract-task-zip";
import { generateTaskFolderName } from "./generate-task-folder-name";
import { getTaskSettings } from "./task-settings";

interface ImportTaskOptions {
  workspaceConfig: WorkspaceConfig;
  zipFileData: string;
}

export async function importTask(
  { workspaceConfig, zipFileData }: ImportTaskOptions,
  _options: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const zipBlob = new Blob([Buffer.from(zipFileData, "base64")]);

    // The final folder name is derived from the task's title, but the title
    // only becomes readable after extraction, so extract under a collision-proof
    // temporary name and rename into place. This gives imports the same
    // sortable, human-readable `YYYY-MM-DD-slug` folder as normal creation
    // instead of an opaque id, keeping them findable when browsing `tasks/`.
    const tempId = TaskIdSchema.parse(`import-${ulid().toLowerCase()}`);
    const tempDirPath = TaskDirSchema.parse(
      absolutePathJoin(workspaceConfig.tasksDir, tempId),
    );

    yield* ResultAsync.fromPromise(
      extractTaskZip({
        outputDir: tempDirPath,
        zipBlob,
      }),
      (error) =>
        new TypedError.FileSystem(
          `Failed to extract zip file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    const settings = await getTaskSettings(tempDirPath);
    const id = TaskIdSchema.parse(
      await generateTaskFolderName({
        prompt: settings?.name,
        tasksDir: workspaceConfig.tasksDir,
      }),
    );

    // For tasks the folder name is identical to the id.
    const taskDirPath = TaskDirSchema.parse(
      absolutePathJoin(workspaceConfig.tasksDir, id),
    );

    yield* ResultAsync.fromPromise(
      fs.rename(tempDirPath, taskDirPath),
      (error) =>
        new TypedError.FileSystem(
          `Failed to name imported task directory: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
    );

    return ok({ taskId: id });
  });
}
