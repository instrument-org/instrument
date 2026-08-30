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
import { getCurrentDate } from "./get-current-date";
import { normalizeTask } from "./migrate-workspace-layout";
import { getTaskSettings, updateTaskSettings } from "./task-settings";

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

    // A zip written by an older build can carry any legacy piece of the task
    // layout: a separate state file, legacy db and settings names, work entries
    // at the root, or a cloned browser profile. The boot sweep is gated by the
    // workspace layout-version marker and will not revisit this task, so the
    // import is where it gets its one full normalization.
    normalizeTask(taskDirPath);

    // An import is activity in this workspace whatever the zip says, so the
    // task lands at the top of the list the way it did when the answer was the
    // extracted files' timestamps. `createdAt` is left to the zip where it
    // carries one: it is the same task, made when it was made.
    //
    // Best-effort, because the task is on disk and usable either way and an
    // unstamped one still lists from its directory.
    const importedAt = getCurrentDate();
    const stamped = await updateTaskSettings(id, {
      createdAt: settings?.createdAt ?? importedAt,
      lastActivityAt: importedAt,
    });
    if (stamped.isErr()) {
      workspaceConfig.captureException(stamped.error);
    }

    return ok({ taskId: id });
  });
}
