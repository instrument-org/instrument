import ms from "ms";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type ChatId } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { killChatBackgroundProcesses } from "./background-processes";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import { recordRemoved } from "./record-changes";
import { forgetChat, resolveChat, chatDir } from "./record-folders";
import {
  disposeSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";

/**
 * Puts a chat in the trash with every task it started, which are sessions in
 * its store. Every agent of the chat's, its tasks' included, is stopped and
 * refused new messages, so nothing it does meanwhile starts a task that would
 * be missed; its browser is reaped, what any of them left running is killed,
 * its store let go; then its folder goes to the trash in one piece. The index
 * forgets it only once the folder is gone.
 */
export async function trashChat({
  id,
  workspaceConfig,
  workspaceRef,
}: {
  id: ChatId;
  workspaceConfig: WorkspaceConfig;
  workspaceRef: WorkspaceActorRef;
}) {
  return ResultAsync.fromPromise(
    (async () => {
      // Block until the chat's browser has fully reaped
      // its WebContentsView and agent-browser daemon sessions, so the
      // Chromium profile is no longer locked when we delete the app dir.
      const browserReaped = new Promise<void>((resolve) => {
        workspaceRef.send({
          type: "prepareToTrashChat",
          value: { id, onBrowserReaped: resolve },
        });
      });

      // Background processes outlive the turn that started them, so the chat
      // going away is what ends them. Wait for that here: their logs live inside
      // the directory about to be deleted, and an orphaned dev server would go on
      // writing into the trashed folder and holding its port.
      const backgroundCleanedUp = killChatBackgroundProcesses(id);

      // Awaited rather than raced, because it is already bounded and its logs are
      // about to be deleted. A process that will not confirm it stopped is still
      // recorded rather than thrown, so it cannot make the chat undeletable.
      // Browser teardown remains best-effort for the same reason: a stuck
      // WebContents must not wedge chat deletion forever.
      await backgroundCleanedUp.catch((error: unknown) => {
        workspaceConfig.captureException(error);
      });
      await Promise.race([browserReaped, setTimeoutPromise(2000)]);

      // Mark storage as disposing to prevent recreation during deletion
      markStorageAsDisposing(id);

      try {
        const chatId = id;

        // Delete node_modules folder before trashing to avoid issues with hard links.
        // On Windows (and potentially other OS) with PNPM hard links, trashing
        // node_modules will fail. Since node_modules can be recreated, we delete
        // it first using the fastest removal method available.
        const nodeModulesPath = absolutePathJoin(
          chatDir(chatId),
          "node_modules",
        );

        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath);
        }

        const disposeResult = await disposeSessionsStoreStorage(id);
        if (disposeResult.isErr()) {
          return err(disposeResult.error);
        }

        // Whether it was a chat, read before the index forgets it.
        const known = resolveChat(chatId) !== undefined;
        await workspaceConfig.trashItem(chatDir(chatId));
        forgetChat(chatId);
        if (known) {
          recordRemoved(chatId);
        }

        // In the off chance that a future chat with the same id is
        // created, it is no longer marked as being trashed.
        workspaceRef.send({
          type: "removeChatBeingTrashed",
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
