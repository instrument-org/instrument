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

/**
 * How long after a process ends before its session is woken. Long enough that
 * a few ending together (a build and the watcher it fed) arrive as one note,
 * short enough that a single ending still feels immediate. The same window a
 * task's finish waits out.
 */
const JOB_WAKE_DEBOUNCE_MS = 1500;

const pending = new Map<
  StoreId.Session,
  { chatId: ChatId; timer: NodeJS.Timeout }
>();

/**
 * Wakes past the debounce whose processes are already marked told, so
 * `unreportedBackgroundProcesses` no longer names them, while the chat's
 * model is looked up and until `wakeSessionForJobs` has run, which counts the
 * wake as on its way from its start (`hasPendingWake`). Added in the same
 * synchronous run as the marking, so no read falls between the two.
 */
const delivering = new Set<{ chatId: ChatId }>();

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
export function startJobWake(workspaceRef: WorkspaceActorRef): void {
  void (async () => {
    for await (const { id, sessionId } of publisher.subscribe(
      "backgroundProcess.settled",
    )) {
      schedule(id, sessionId, workspaceRef);
    }
  })();
  void (async () => {
    for await (const { id, notice, sessionId } of publisher.subscribe(
      "session.done",
    )) {
      if (notice?.by === "user" || notice?.by === "chat") {
        stopped.add(sessionId);
      } else {
        stopped.delete(sessionId);
      }
      schedule(id, sessionId, workspaceRef);
    }
  })();
}

function schedule(
  chatId: ChatId,
  sessionId: StoreId.Session,
  workspaceRef: WorkspaceActorRef,
) {
  clearTimeout(pending.get(sessionId)?.timer);
  const timer = setTimeout(() => {
    pending.delete(sessionId);
    deliver(chatId, sessionId, workspaceRef).catch((error: unknown) => {
      getWorkspaceConfig().captureException(error);
    });
  }, JOB_WAKE_DEBOUNCE_MS);
  timer.unref();
  pending.set(sessionId, { chatId, timer });
}

async function deliver(
  chatId: ChatId,
  sessionId: StoreId.Session,
  workspaceRef: WorkspaceActorRef,
) {
  // Its turn's end schedules this again for whatever it did not read.
  if (isWorkingNow(chatId, sessionId)) {
    return;
  }
  const ended = unreportedBackgroundProcesses(sessionId);
  if (ended.length === 0) {
    return;
  }
  // Told before the wake is sent, so nothing can report them a second time.
  markBackgroundProcessesReported(
    sessionId,
    ended.map((process) => process.id),
  );
  if (stopped.has(sessionId)) {
    return;
  }
  const onItsWay = { chatId };
  delivering.add(onItsWay);
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
    delivering.delete(onItsWay);
  }
}

/**
 * Whether a session of the chat has a wake waiting out the debounce that will
 * start a turn: something it left running ended unread, and no stop holds
 * the news back. The chat is still at work in that gap, the way it is while
 * a task's finish waits to wake it, and once the debounce is over it
 * stays so until the wake is sent.
 */
export function hasPendingJobWake(chatId: ChatId): boolean {
  for (const entry of delivering) {
    if (entry.chatId === chatId) {
      return true;
    }
  }
  for (const [sessionId, entry] of pending) {
    if (
      entry.chatId === chatId &&
      !stopped.has(sessionId) &&
      unreportedBackgroundProcesses(sessionId).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/** Whether the session has a turn running, or false where no workspace is running to ask. */
function isWorkingNow(chatId: ChatId, sessionId: StoreId.Session): boolean {
  try {
    return isWorking(chatId, sessionId);
  } catch {
    return false;
  }
}
