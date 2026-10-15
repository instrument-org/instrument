import ms from "ms";
import { err, ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type ChatId } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { killChatBackgroundProcesses } from "./background-processes";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import { recordRemoved } from "./record-changes";
import {
  forgetChat,
  resolveChat,
  chatDir,
  sessionOfChat,
} from "./record-folders";
import { closeAgentBrowserSessionsForSessions } from "./agent-browser-cleanup";
import { workDir } from "./work-dir";
import { listChildTasks } from "./chat/children";
import {
  disposeSessionsStoreStorage,
  markStorageAsDisposing,
  unmarkStorageAsDisposing,
} from "./session-store-storage";
import { StoreRecords } from "./store-records";

/**
 * Puts a chat in the trash with every task it started, which are sessions in
 * its store. Every agent of the chat's, its tasks' included, is stopped and
 * refused new messages, so nothing it does meanwhile starts a task that would
 * be missed; what any of them left running is killed, its store let go; then
 * its record folder and its work folder each go to the trash in one piece,
 * where the system's own put-back returns each to its place. The index
 * forgets it once its records are gone; a work folder that will not go is
 * reported and left.
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
      workspaceRef.send({ type: "prepareToTrashChat", value: { id } });

      // Background processes outlive the turn that started them, so the chat
      // going away is what ends them. Wait for that here: their logs live inside
      // the work folder about to be deleted, and an orphaned dev server would go
      // on writing into the trashed folder and holding its port.
      const backgroundCleanedUp = killChatBackgroundProcesses(id);

      // Awaited rather than raced, because it is already bounded and its logs are
      // about to be deleted. A process that will not confirm it stopped is still
      // recorded rather than thrown, so it cannot make the chat undeletable.
      await backgroundCleanedUp.catch((error: unknown) => {
        workspaceConfig.captureException(error);
      });
      // Every session's agent-browser daemons, read before the store goes.
      const sessions = [
        sessionOfChat(id),
        ...(await listChildTasks(id)).map((task) => task.id),
      ].filter((session) => session !== undefined);
      await closeAgentBrowserSessionsForSessions(sessions).catch(
        (error: unknown) => {
          workspaceConfig.captureException(error);
        },
      );

      // Mark storage as disposing to prevent recreation during deletion
      markStorageAsDisposing(id);

      try {
        const chatId = id;

        // Delete node_modules folder before trashing to avoid issues with hard links.
        // On Windows (and potentially other OS) with PNPM hard links, trashing
        // node_modules will fail. Since node_modules can be recreated, we delete
        // it first using the fastest removal method available.
        const work = workDir(chatId);
        const nodeModulesPath = absolutePathJoin(work, "node_modules");

        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath);
        }

        const disposeResult = await disposeSessionsStoreStorage(id);
        if (disposeResult.isErr()) {
          return err(disposeResult.error);
        }
        // Its records let go once every session of it has stopped and before
        // the folder goes: an append landing after the delete would make the
        // folder again.
        await StoreRecords.close(id);

        // Whether it was a chat, read before the index forgets it.
        const known = resolveChat(chatId) !== undefined;
        // The records first: once they are gone the chat is, and a work
        // folder that would not follow is only files left behind.
        await workspaceConfig.trashItem(chatDir(chatId));
        forgetChat(chatId);
        if (known) {
          recordRemoved(chatId);
        }
        // A chat whose agent never ran a command has no work folder.
        if (await pathExists(work)) {
          await workspaceConfig.trashItem(work).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }

        return ok({ id });
      } finally {
        // Always unmark the chat, even if deletion fails: a chat still
        // marked refuses new sessions, and a chat later made with the same
        // id must not inherit the mark.
        unmarkStorageAsDisposing(id);
        workspaceRef.send({
          type: "removeChatBeingTrashed",
          value: { id },
        });
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
