import ms from "ms";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { killTaskBackgroundProcesses } from "./background-processes";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import {
  disposeSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";
import { taskDir } from "./task-dir-utils";

interface RemoveTaskOptions {
  id: TaskId;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}

export async function trashTask({
  id,
  workspaceConfig,
  workspaceRef,
}: RemoveTaskOptions) {
  return ResultAsync.fromPromise(
    (async () => {
      // Block until every taskBrowser for this id has fully reaped
      // its WebContentsView and agent-browser daemon sessions, so the
      // Chromium profile is no longer locked when we delete the app dir.
      const browserReaped = new Promise<void>((resolve) => {
        workspaceRef.send({
          type: "prepareToTrashTask",
          value: { id, onBrowserReaped: resolve },
        });
      });

      // Background processes outlive the turn that started them, so the task
      // going away is what ends them. Wait for that here: their logs live inside
      // the directory about to be deleted, and an orphaned dev server would go on
      // writing into the trashed folder and holding its port.
      const backgroundCleanedUp = killTaskBackgroundProcesses(id);

      // Awaited rather than raced, because it is already bounded and its logs are
      // about to be deleted. A process that will not confirm it stopped is still
      // recorded rather than thrown, so it cannot make the task undeletable.
      // Browser teardown remains best-effort for the same reason: a stuck
      // WebContents must not wedge task deletion forever.
      await backgroundCleanedUp.catch((error: unknown) => {
        workspaceConfig.captureException(error);
      });
      await Promise.race([browserReaped, setTimeoutPromise(2000)]);

      // Mark storage as disposing to prevent recreation during deletion
      markStorageAsDisposing(id);

      try {
        const taskId = id;

        // Delete node_modules folder before trashing to avoid issues with hard links.
        // On Windows (and potentially other OS) with PNPM hard links, trashing
        // node_modules will fail. Since node_modules can be recreated, we delete
        // it first using the fastest removal method available.
        const nodeModulesPath = absolutePathJoin(
          taskDir(taskId),
          "node_modules",
        );

        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath);
        }

        const disposeResult = await disposeSessionsStoreStorage(id);
        if (disposeResult.isErr()) {
          return err(disposeResult.error);
        }

        await workspaceConfig.trashItem(taskDir(taskId));

        // In the off chance that a future task with the same id is
        // created, we remove the app being trashed.
        workspaceRef.send({
          type: "removeTaskBeingTrashed",
          value: { id },
        });

        return ok({ id });
      } finally {
        // Always unmark storage as disposing, even if deletion fails
        unmarkStorageAsDisposing(id);
      }
    })(),
    (error: unknown) =>
      new TypedError.FileSystem(
        error instanceof Error ? error.message : "Unknown error",
        { cause: error },
      ),
  );
}

async function rmrf(path: string): Promise<void> {
  await fs.rm(path, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: ms("2 seconds"),
  });
}
