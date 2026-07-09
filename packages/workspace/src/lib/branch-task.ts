import { errAsync, ok, ResultAsync, safeTry } from "neverthrow";
import fs from "node:fs/promises";

import { type StoreId } from "../schemas/store-id";
import { type TaskId, TaskIdSchema } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { copyTask } from "./copy-task";
import { TypedError } from "./errors";
import { clearFileIndexBaselines } from "./file-index-baseline";
import { generateBranchFolderName } from "./generate-task-folder-name";
import { pathExists } from "./path-exists";
import { Store } from "./store";
import { getTaskPrivateDir, sessionStorePath, taskDir } from "./task-dir-utils";
import { getTaskSettings, updateTaskSettings } from "./task-settings";
import { getTaskState, setTaskState } from "./task-state-store";

interface BranchTaskOptions {
  // When set, the branch keeps the conversation only up to and including this
  // message; everything after it in the session is dropped. Omit to branch the
  // whole task.
  branchPoint?: { messageId: StoreId.Message; sessionId: StoreId.Session };
  sourceTaskId: TaskId;
  workspaceConfig: WorkspaceConfig;
}

export async function branchTask(
  { branchPoint, sourceTaskId, workspaceConfig }: BranchTaskOptions,
  { signal }: { signal?: AbortSignal } = {},
) {
  return safeTry(async function* () {
    const sourceId = sourceTaskId;

    const sourceExists = await pathExists(taskDir(sourceId));
    if (!sourceExists) {
      return errAsync(
        new TypedError.NotFound(
          `Source task directory does not exist: ${taskDir(sourceId)}`,
        ),
      );
    }

    const branchFolder = await generateBranchFolderName({
      sourceFolderName: sourceId,
      tasksDir: workspaceConfig.tasksDir,
    });
    const taskId = TaskIdSchema.parse(branchFolder.name);

    // Ensure the parent tasks dir exists (idempotent), then create the task
    // dir non-recursively so it acts as an atomic existence guard. Two
    // concurrent branches can both pass the folder-name check above, so we rely
    // on mkdir failing with EEXIST instead.
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
    // Strip any existing counter so branching a branch stays flat ("X (2)" not
    // "X (2) (2)"), then reuse the folder's suffix as the display counter.
    const baseName = sourceName.replace(/\s*\(\d+\)$/, "");
    const branchName =
      branchFolder.suffix > 1
        ? `${baseName} (${branchFolder.suffix})`
        : baseName;

    const sourceSessionDbPath = sessionStorePath(taskDir(sourceId));
    const targetSessionDbPath = sessionStorePath(taskDir(taskId));

    if (await pathExists(sourceSessionDbPath)) {
      const targetPrivateDir = getTaskPrivateDir(taskDir(taskId));
      await fs.mkdir(targetPrivateDir, { recursive: true });
      await fs.copyFile(sourceSessionDbPath, targetSessionDbPath);
      yield* clearFileIndexBaselines(taskId, { signal });

      if (branchPoint) {
        const messageIdsAfter = yield* Store.getMessageIdsAfter(
          branchPoint.sessionId,
          branchPoint.messageId,
          taskId,
          { signal },
        );
        for (const messageId of messageIdsAfter) {
          yield* Store.removeMessage(messageId, branchPoint.sessionId, taskId, {
            signal,
          });
        }
      }
    }

    await setTaskState(taskDir(taskId), await getTaskState(taskDir(sourceId)));

    yield* updateTaskSettings(taskId, {
      createdWithAppVersion: sourceSettings?.createdWithAppVersion,
      name: branchName,
      projectId: sourceSettings?.projectId,
    });

    return ok({ taskId });
  });
}
