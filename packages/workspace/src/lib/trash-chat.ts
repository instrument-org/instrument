import ms from "ms";
import { ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type ChatId } from "../schemas/chat-id";
import { type WorkspaceConfig } from "../types";
import { absolutePathJoin } from "./absolute-path-join";
import { killChatBackgroundProcesses } from "./background-processes";
import { TypedError } from "./errors";
import { pathExists } from "./path-exists";
import { forgetChatPermissions } from "./permissions/rules";
import { recordChatFolderName } from "./chat-folders/own-folder";
import { chatGone } from "./chat-gone";
import { chatOwnFolder, chatDir, sessionOfChat } from "./record-folders";
import { closeAgentBrowserSessionsForSessions } from "./agent-browser-cleanup";
import { writingChatRecords } from "./records/chat-records";
import { workDir } from "./work-dir";
import { listChildTasks } from "./chat/children";

/**
 * Puts a chat in the trash with every task it started, which are sessions in
 * its store. Every agent of the chat's, its tasks' included, is stopped and
 * refused new messages, so nothing it does meanwhile starts a task that would
 * be missed; what any of them left running is killed; then its
 * record folder and its work folder each go to the trash in one piece,
 * where the system's own put-back returns each to its place. The index
 * forgets it once its records are gone; a work folder that will not go is
 * reported and left.
 */
export async function trashChat({
  id,
  itsFolder = false,
  workspaceConfig,
  workspaceRef,
}: {
  id: ChatId;
  /**
   * Whether the chat's own folder goes too, with the transcript and
   * whatever the agent made in it. Off unless the person asked on the
   * delete screen: what is in there is theirs, and a chat they deleted to
   * tidy their list is not a request to throw the work away.
   */
  itsFolder?: boolean;
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

      try {
        const chatId = id;

        // Delete node_modules folder before trashing to avoid issues with hard links.
        // On Windows (and potentially other OS) with PNPM hard links, trashing
        // node_modules will fail. Since node_modules can be recreated, we delete
        // it first using the fastest removal method available.
        const work = workDir(chatId);
        // Read before the chat goes: its own folder is found through the
        // chat, and the name this computer recorded is forgotten with it.
        const ownFolder = itsFolder
          ? chatOwnFolder(chatDir(chatId))
          : undefined;
        const nodeModulesPath = absolutePathJoin(work, "node_modules");

        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath);
        }

        // Its records let go once every session of it has stopped and before
        // the folder goes: an append landing after the delete would make the
        // folder again.
        await writingChatRecords()?.close(id);

        // The records first: once they are gone the chat is, and a work
        // folder that would not follow is only files left behind.
        await workspaceConfig.trashItem(chatDir(chatId));
        await recordChatFolderName(
          workspaceConfig.workspaceMachineDir,
          chatId,
          undefined,
        ).catch((error: unknown) => {
          workspaceConfig.captureException(error);
        });
        // What it was allowed and refused goes with it: a deleted chat is
        // not coming back, and its grants would only pile up in the file.
        await forgetChatPermissions(chatId).catch((error: unknown) => {
          workspaceConfig.captureException(error);
        });
        await chatGone(chatId);
        // A chat whose agent never ran a command has no work folder.
        if (await pathExists(work)) {
          await workspaceConfig.trashItem(work).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }
        // Last, and only when asked: the person can put it back from the
        // trash, and a failure here leaves files rather than losing them.
        if (ownFolder !== undefined && (await pathExists(ownFolder))) {
          await workspaceConfig.trashItem(ownFolder).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }

        return ok({ id });
      } finally {
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
