import ms from "ms";
import { waitFor } from "xstate";

import { type WorkspaceActorRef } from "../machines/workspace";
import { closeAllAgentBrowserSessions } from "./agent-browser-cleanup";
import { killAllBackgroundProcesses } from "./background-processes";
import { stopBashWorker } from "./bash-worker/client";
import { interruptTasksForQuit } from "./chat/wake";
import { forgetChatFolders } from "./record-folders";
import { chatRecords, installChatRecords } from "./records/chat-records";
import { stopRecordArrivals } from "./records/take-arrivals";
import { closeWorkspaceDb } from "./workspace-db";

/** How long the sessions still running get to stop before the actor stops them outright. */
const SESSIONS_STOP_MS = ms("10 seconds");

/**
 * Closes the workspace `workspaceRef` runs, for a process that goes on to
 * open another: the tasks at work are stopped and their chats told as a quit
 * does, every other running session is stopped, what agents left running
 * ends, `detach` takes the chat wiring off, the records are landed and
 * synced, the actor stops (its server with it), and every module this
 * package keeps for the open workspace lets it go (`workspace.db`, the chat
 * index, the bash worker), so the next actor's config is the one they read.
 *
 * Never throws: each step's failure goes to `onError` and the next runs.
 */
export async function closeWorkspace({
  detach,
  onError,
  workspaceRef,
}: {
  detach: () => void;
  onError: (error: unknown) => void;
  workspaceRef: WorkspaceActorRef;
}): Promise<void> {
  const step = async (run: () => Promise<void> | void) => {
    try {
      await run();
    } catch (error) {
      onError(error);
    }
  };
  await step(() => interruptTasksForQuit(workspaceRef));
  await step(() => stopRunningSessions(workspaceRef));
  await step(() => killAllBackgroundProcesses());
  await step(() => closeAllAgentBrowserSessions());
  await step(detach);
  await step(stopRecordArrivals);
  await step(() => chatRecords().dispose());
  await step(() => {
    workspaceRef.stop();
  });
  await step(() => {
    installChatRecords(undefined);
    closeWorkspaceDb();
    forgetChatFolders();
  });
  await step(stopBashWorker);
}

/**
 * Stops every session still at work, as the app, waking nobody, and waits
 * for them to finish what they write on the way out.
 */
async function stopRunningSessions(workspaceRef: WorkspaceActorRef) {
  for (const [id, refs] of workspaceRef.getSnapshot().context
    .sessionRefsByChatId) {
    for (const ref of refs) {
      workspaceRef.send({
        type: "stopSessions",
        value: {
          id,
          notice: { by: "app", wakesChat: false },
          reason: "quit",
          sessionId: ref.getSnapshot().context.sessionId,
        },
      });
    }
  }
  await waitFor(
    workspaceRef,
    (snapshot) =>
      [...snapshot.context.sessionRefsByChatId.values()].every((refs) =>
        refs.every((ref) => ref.getSnapshot().status !== "active"),
      ),
    { timeout: SESSIONS_STOP_MS },
  ).catch(() => undefined);
}
