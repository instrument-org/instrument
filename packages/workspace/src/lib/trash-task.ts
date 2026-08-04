import ms from "ms";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type TaskId } from "../schemas/task-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import {
  disposeSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";
import { getArtifactPreviewSessionDir, taskDir } from "./task-dir-utils";

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

      // Cap the wait so a stuck reap can't hang trashing forever; the old
      // 500ms sleep was already best-effort, this is a strict upper bound.
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

        // The artifact preview's storage profile lives outside the task folder
        // (a Chromium profile has no business in a directory the user browses),
        // so trashing the task does not take it. Best-effort: a profile left
        // behind is dead weight, not a correctness problem, and it must not
        // fail the deletion the user asked for. The guest that owned it is
        // already reaped by the time we get here.
        const previewProfile = getArtifactPreviewSessionDir(taskId);
        if (await pathExists(previewProfile)) {
          await rmrf(previewProfile).catch(() => {
            // Nothing to do: the task itself is gone.
          });
        }

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
