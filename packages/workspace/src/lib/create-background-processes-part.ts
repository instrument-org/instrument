import { z } from "zod";

import { type SessionMessagePart } from "../schemas/session/message-part";
import { StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";
import { listBackgroundProcesses } from "./background-processes";
import { getCurrentDate } from "./get-current-date";
import { getParsedStorageItem } from "./get-parsed-storage-item";
import { getSessionsStoreStorage } from "./session-store-storage";
import { setParsedStorageItem } from "./set-parsed-storage-item";
import { StorageKey } from "./storage-key";
import { getWorkspaceConfig } from "./workspace-config";

const ReportedProcessesSchema = z.array(
  z.object({ command: z.string(), id: z.string() }),
);

/**
 * What this session still has running, for the turn about to start.
 *
 * The problem it solves is that the registry lives in memory and the transcript
 * does not. A tool result from an earlier turn says `bg_1` was running *then*;
 * nothing says whether it is running now. So an agent picking a conversation
 * back up either starts a second copy of a server that is already listening, or
 * tells the user to open a URL for a process that has since been killed.
 *
 * Attached only when the answer changed, the way the browser status and pane
 * tabs parts are: restating an unchanged list every turn spends context saying
 * something the agent was already told and has no reason to doubt.
 *
 * `ended` is the half that a restart needs. Nothing in the registry survives a
 * quit, so after one there is no process to describe -- and silence would leave
 * the agent believing the last thing it was told, which was that a server was
 * up. Naming what went away is the only way to correct that.
 */
export async function createBackgroundProcessesPart({
  createdAt,
  messageId,
  sessionId,
  taskId,
}: {
  createdAt: Date;
  messageId: StoreId.Message;
  sessionId: StoreId.Session;
  taskId: TaskId;
}): Promise<SessionMessagePart.Type | undefined> {
  try {
    const storage = await getSessionsStoreStorage(taskId);
    if (storage.isErr()) {
      return undefined;
    }

    const reported = await getParsedStorageItem(
      StorageKey.backgroundProcessesReported(sessionId),
      ReportedProcessesSchema,
      storage.value,
    );
    // An error here is "nothing recorded yet" as often as a real failure, and
    // both mean this session has been told nothing.
    const previous = reported.isOk() ? reported.value : [];

    const now = getCurrentDate().getTime();
    const processes = listBackgroundProcesses(sessionId);
    const running = processes
      .filter((process) => process.status === "running")
      .map((process) => ({
        command: process.command,
        id: process.id,
        runningForMs: Math.max(0, now - process.startedAt.getTime()),
      }));

    // A stop that timed out leaves a process that may or may not still be there,
    // which is what `termination-uncertain` means and what `fg` says about one in
    // words. It is therefore in neither list: calling it running would claim a
    // server is up, and calling it ended would tell the agent to start a second
    // copy of something still holding the port. It stays in what this session has
    // been told, so it is reported as ended once it settles or the app restarts.
    const stillThere = processes
      .filter(
        (process) =>
          process.status === "running" ||
          process.status === "termination-uncertain",
      )
      .map(({ command, id }) => ({ command, id }));
    const stillThereIds = new Set(stillThere.map((process) => process.id));
    const ended = previous.filter(
      (process) => !stillThereIds.has(process.id),
    );

    // Nothing running and nothing to correct is the common case.
    if (running.length === 0 && ended.length === 0) {
      return undefined;
    }
    // Same set as last time, and nothing has gone away. Durations move on their
    // own and are not news; what is running is.
    if (
      ended.length === 0 &&
      previous.length === stillThere.length &&
      stillThere.every((process) =>
        previous.some((earlier) => earlier.id === process.id),
      )
    ) {
      return undefined;
    }

    await setParsedStorageItem(
      StorageKey.backgroundProcessesReported(sessionId),
      stillThere,
      ReportedProcessesSchema,
      storage.value,
    );

    return {
      data: { ended, running },
      metadata: {
        createdAt,
        id: StoreId.newPartId(),
        messageId,
        sessionId,
      },
      type: "data-backgroundProcesses",
    };
  } catch (error) {
    getWorkspaceConfig().captureException(error);
    return undefined;
  }
}
