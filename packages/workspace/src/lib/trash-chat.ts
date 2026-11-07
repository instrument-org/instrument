import ms from "ms";
import { ok, ResultAsync } from "neverthrow";
import fs from "node:fs/promises";

import { type WorkspaceActorRef } from "../machines/workspace";
import { type ChatId } from "../schemas/chat-id";
import { type AbsolutePath } from "../schemas/paths";
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
import { STOP_FAILSAFE_MS } from "../machines/session";

/**
 * How long the trash waits for the chat's sessions to end once told to
 * stop: past the failsafe that tears down an agent that will not, with room
 * for the cut-off turn it then writes.
 */
const SESSIONS_END_MS = STOP_FAILSAFE_MS + ms("3 seconds");

/** How often the trash looks whether the chat's sessions have ended. */
const SESSIONS_POLL_MS = 50;

/**
 * Waits between tries at moving a folder to the trash. On Windows a folder
 * will not move while anything has a file in it open, and what had one
 * (a command just ended, the indexer, a virus scan) lets go within moments.
 */
const TRASH_RETRY_DELAYS_MS = [ms("500 milliseconds"), ms("1.5 seconds")];

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
      let releaseRecords: (() => void) | undefined;

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
      // A stopped session still writes how its turn ended and lets go of
      // what its commands had open, so the folders go once every session
      // has ended. One that has not by the deadline is past its own
      // failsafe, and its records are refused below all the same.
      await sessionsEnded(workspaceRef, id);
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

        // A package that will not go leaves its folder to the work folder's
        // own trash below, which reports and leaves one that will not move,
        // rather than keeping the chat.
        if (await pathExists(nodeModulesPath)) {
          await rmrf(nodeModulesPath).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }

        // Its records let go once every session of it has stopped, and take
        // nothing more until the index has forgotten the chat: an append
        // landing after the folder went would make it again.
        const records = chatDir(chatId);
        releaseRecords = await writingChatRecords()?.refuse(id);

        // The records first: once they are gone the chat is, and a work
        // folder that would not follow is only files left behind.
        await toTrash(workspaceConfig, records);
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
          await toTrash(workspaceConfig, work).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }
        // Last, and only when asked: the person can put it back from the
        // trash, and a failure here leaves files rather than losing them.
        if (ownFolder !== undefined && (await pathExists(ownFolder))) {
          await toTrash(workspaceConfig, ownFolder).catch((error: unknown) => {
            workspaceConfig.captureException(error);
          });
        }

        return ok({ id });
      } finally {
        releaseRecords?.();
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

/**
 * Resolves once no session of the chat is still running, or at the
 * deadline. A session that has ended drops out of the chat's refs, and one
 * on its way out reports itself no longer active.
 */
async function sessionsEnded(workspaceRef: WorkspaceActorRef, id: ChatId) {
  const deadline = Date.now() + SESSIONS_END_MS;
  const running = () =>
    (workspaceRef.getSnapshot().context.sessionRefsByChatId.get(id) ?? []).some(
      (ref) => ref.getSnapshot().status === "active",
    );
  while (running() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SESSIONS_POLL_MS));
  }
}

/** Moves a folder to the trash, trying again while something lets go of it. */
async function toTrash(workspaceConfig: WorkspaceConfig, item: AbsolutePath) {
  for (const delay of TRASH_RETRY_DELAYS_MS) {
    try {
      await workspaceConfig.trashItem(item);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!(await pathExists(item))) {
        return;
      }
    }
  }
  await workspaceConfig.trashItem(item);
}

async function rmrf(path: string): Promise<void> {
  await fs.rm(path, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: ms("2 seconds"),
  });
}
