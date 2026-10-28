import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { type StoreId } from "../../schemas/store-id";
import {
  markBackgroundProcessesReported,
  unreportedBackgroundProcesses,
} from "../background-processes";
import { chatModelURI } from "../chat-settings";
import { resolveChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";
import { isWorking } from "./activity";
import { wakeSessionForJobs } from "./wake";
import { countOnItsWay } from "./wake-queue";

/**
 * How long after a process ends before its session is woken. Long enough that
 * a few ending together (a build and the watcher it fed) arrive as one note,
 * short enough that a single ending still feels immediate. The same window a
 * task's finish waits out.
 */
const JOB_WAKE_DEBOUNCE_MS = 1500;

const pending = new Map<
  StoreId.Session,
  { release: () => void; timer: NodeJS.Timeout }
>();

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
  void (async () => {
    for await (const { id, sessionId } of publisher.subscribe(
      "backgroundProcess.settled",
    )) {
      schedule(id, sessionId, workspaceRef, debounceMs);
    }
  })();
  void (async () => {
    for await (const { id, notice, sessionId } of publisher.subscribe(
      "session.done",
    )) {
      if (notice?.by === "person" || notice?.by === "agent") {
        stopped.add(sessionId);
      } else {
        stopped.delete(sessionId);
      }
      schedule(id, sessionId, workspaceRef, debounceMs);
    }
  })();
}

function schedule(
  chatId: ChatId,
  sessionId: StoreId.Session,
  workspaceRef: WorkspaceActorRef,
  debounceMs: number,
) {
  const existing = pending.get(sessionId);
  clearTimeout(existing?.timer);
  // Counted while it waits only when it will start a turn: something the
  // session left running ended unread, and no stop holds the news back.
  // Every turn's end schedules one, which most have nothing to tell.
  const release =
    existing?.release ??
    countOnItsWay(chatId, {
      stillNews: () =>
        !stopped.has(sessionId) &&
        unreportedBackgroundProcesses(sessionId).length > 0,
    });
  const timer = setTimeout(() => {
    pending.delete(sessionId);
    deliver(chatId, sessionId, workspaceRef, release).catch(
      (error: unknown) => {
        getWorkspaceConfig().captureException(error);
      },
    );
  }, debounceMs);
  timer.unref();
  pending.set(sessionId, { release, timer });
}

async function deliver(
  chatId: ChatId,
  sessionId: StoreId.Session,
  workspaceRef: WorkspaceActorRef,
  /** Lets go of the count its debounce held. */
  waited: () => void,
) {
  // Its turn's end schedules this again for whatever it did not read.
  const ended = isWorkingNow(chatId, sessionId)
    ? []
    : unreportedBackgroundProcesses(sessionId);
  if (ended.length > 0) {
    // Told before the wake is sent, so nothing can report them a second time.
    markBackgroundProcessesReported(
      sessionId,
      ended.map((process) => process.id),
    );
  }
  if (ended.length === 0 || stopped.has(sessionId)) {
    waited();
    return;
  }
  // Counted from here until the wake is sent, in the same synchronous run as
  // the marking, so no read falls between the debounce and the wake.
  const release = countOnItsWay(chatId);
  waited();
  try {
    // A chat nobody has written in has no model to wake with.
    if (!resolveChat(chatId) || !(await chatModelURI(chatId))) {
      return;
    }
    await wakeSessionForJobs(
      {
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
      },
      workspaceRef,
      chatId,
      sessionId,
    );
  } finally {
    release();
  }
}

/** Whether the session has a turn running, or false where no workspace is running to ask. */
function isWorkingNow(chatId: ChatId, sessionId: StoreId.Session): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
