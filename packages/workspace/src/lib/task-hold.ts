import { publisher } from "../rpc/publisher";
import { type TaskId } from "../schemas/task-id";

/**
 * Why a task that exists has not started, and since when: `reason` for the
 * conversation that made it (`macOS is asking the user about "Desktop"`),
 * `userReason` for the person looking at it (`Waiting for you to allow access
 * to Desktop`).
 */
export interface TaskHold {
  reason: string;
  since: Date;
  userReason: string;
}

interface Held extends TaskHold {
  /** What was sent to the task while it waited, delivered after it starts, in order. */
  queued: (() => void)[];
}

/**
 * Tasks held from starting, by id. In memory only, because what releases a
 * hold is a promise in this process: after a restart there is nothing left to
 * settle it, and the task is simply never started. Starting it then would do
 * the work without the answer it was held for, so it stays as it was made:
 * idle, with nothing said, for the conversation or the user to start again.
 */
const holds = new Map<TaskId, Held>();

/**
 * Cancels a held task's start, and everything queued behind it: the task never
 * runs, even when `until` settles later. The hold it had, or undefined when
 * the task was not held.
 */
export function cancelHold(taskId: TaskId): TaskHold | undefined {
  const held = holds.get(taskId);
  if (!held) {
    return undefined;
  }
  holds.delete(taskId);
  publisher.publish("task.updated", { id: taskId });
  return {
    reason: held.reason,
    since: held.since,
    userReason: held.userReason,
  };
}

/**
 * Holds a task from starting until `until` settles, then starts it with what
 * `until` settled to, then delivers whatever was queued behind the hold. The
 * cause is the caller's: a folder the system is asking about, a sign-in, a
 * rate limit; the registry only knows it by its reasons. `until` settles to a
 * value rather than rejecting, since a cause that can fail says so in the
 * value; a rejection drops the hold as a cancel would.
 */
export function holdTask<T>(
  taskId: TaskId,
  {
    reason,
    start,
    until,
    userReason,
  }: {
    reason: string;
    start: (value: T) => void;
    until: Promise<T>;
    userReason: string;
  },
): void {
  const held: Held = {
    queued: [],
    reason,
    since: new Date(),
    userReason,
  };
  holds.set(taskId, held);
  publisher.publish("task.updated", { id: taskId });
  void until.then(
    (value) => {
      // Canceled, or replaced by a newer hold, while it waited.
      if (holds.get(taskId) !== held) {
        return;
      }
      holds.delete(taskId);
      start(value);
      for (const deliver of held.queued) {
        deliver();
      }
      publisher.publish("task.updated", { id: taskId });
    },
    () => {
      if (holds.get(taskId) === held) {
        cancelHold(taskId);
      }
    },
  );
}

/**
 * Queues `deliver` to run once the held task has started, after its own start
 * and anything queued before it. False when the task is not held, so the
 * caller delivers now.
 */
export function queueBehindHold(taskId: TaskId, deliver: () => void): boolean {
  const held = holds.get(taskId);
  if (!held) {
    return false;
  }
  held.queued.push(deliver);
  return true;
}

/** Why the task is held from starting, or undefined when it is not. */
export function taskHold(taskId: TaskId): TaskHold | undefined {
  const held = holds.get(taskId);
  return held
    ? { reason: held.reason, since: held.since, userReason: held.userReason }
    : undefined;
}
