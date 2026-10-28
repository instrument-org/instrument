import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type StoreId } from "../../schemas/store-id";
import {
  markBackgroundProcessesReported,
  unreportedBackgroundProcesses,
} from "../background-processes";
import { enqueueWake, type WakePart } from "./wake-queue";

/**
 * How long after a process ends before its session is woken. Long enough that
 * a few ending together (a build and the watcher it fed) arrive as one note,
 * short enough that a single ending still feels immediate. The same window a
 * task's finish waits out.
 */
const JOB_WAKE_DEBOUNCE_MS = 1500;

/**
 * Sessions whose last turn was stopped by the user or by the chat. What they
 * left running ending afterward wakes nothing: Stop means stop, and the next
 * turn's own note says the process is gone.
 */
const stopped = new Set<StoreId.Session>();

/**
 * Wakes a session when a background process it started ends on its own after
 * its turn is over: the agent said it would wait on a command, ended its
 * turn, and the command finished (a privacy prompt answered, a slow build
 * done). Without this the news sits in the registry until the user writes
 * again.
 *
 * Only a session at rest is woken. One with a turn running hears of it
 * through `fg` and `jobs` as it works, and what it never read by the end of
 * that turn wakes it once the turn is over. A stop somebody asked for (the
 * agent's own `kill`, the user's, the conversation's `instrument task stop`, the app's
 * quit) is never news, and each process is reported once: the wake marks it
 * told before it is sent, so the turn it starts cannot start another.
 */
export function startJobWake(
  workspaceRef: WorkspaceActorRef,
  { debounceMs = JOB_WAKE_DEBOUNCE_MS }: { debounceMs?: number } = {},
): void {
  // Heard in the tick they are published, so a stop is recorded before
  // anything reads whether the session's news still counts.
  publisher.subscribe("backgroundProcess.settled", ({ id, sessionId }) => {
    void enqueueWake({
      chatId: id,
      debounceMs,
      key: "jobs",
      part: () => jobsPart(sessionId),
      restingOnly: true,
      sessionId,
      // A wake waiting counts as on its way only when it will start a turn:
      // something the session left running ended unread, and no stop holds
      // the news back.
      stillNews: () =>
        !stopped.has(sessionId) &&
        unreportedBackgroundProcesses(sessionId).length > 0,
      workspaceRef,
    });
  });
  publisher.subscribe("session.done", ({ notice, sessionId }) => {
    if (notice?.by === "person" || notice?.by === "agent") {
      stopped.add(sessionId);
    } else {
      stopped.delete(sessionId);
    }
  });
}

/**
 * The note for what the session left running that has ended unread, or none
 * when nothing has or a stop holds it back. Each process it names is marked
 * told as it is read, and so is each a stop holds back, so none is reported
 * a second time.
 */
function jobsPart(
  sessionId: StoreId.Session,
): Extract<WakePart, { type: "data-jobEvent" }> | undefined {
  const ended = unreportedBackgroundProcesses(sessionId);
  if (ended.length === 0) {
    return undefined;
  }
  markBackgroundProcessesReported(
    sessionId,
    ended.map((process) => process.id),
  );
  if (stopped.has(sessionId)) {
    return undefined;
  }
  return {
    data: {
      events: ended.map((process) => ({
        command: process.command,
        durationMs: process.durationMs,
        ...(process.exitCode === undefined
          ? {}
          : { exitCode: process.exitCode }),
        id: process.id,
        logFilePath: process.logFilePath,
        status:
          process.status === "running"
            ? "termination-uncertain"
            : process.status,
      })),
    },
    type: "data-jobEvent",
  };
}
