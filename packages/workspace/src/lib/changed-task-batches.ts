import { AsyncIteratorClass } from "@orpc/server";

import { publisher } from "../rpc/publisher";
import { type TaskId } from "../schemas/task-id";

export interface ChangedTaskBatch {
  removed: Set<TaskId>;
  updated: Set<TaskId>;
}

// Folds task activity/removal events into a deduped map of changed task ids and
// yields one batch per drain. The ids are what a subscriber patching a held
// list needs, so the publisher's single-event buffer is not enough on its own:
// two tasks changing while a consumer is busy would keep only the later event
// and strand the other task at its old place in the list. Callback
// subscriptions capture every event synchronously at publish time instead, and
// a burst collapses into one batch because the consumer only pulls the next
// batch after it finishes the current one. Subscriptions register when this
// function is called (not on the first pull), so a caller can subscribe before
// taking an initial snapshot and no event lands unobserved in between. Tears
// down on signal abort or on iterator return/throw; either path unsubscribes
// and settles a pending pull with done.
export function changedTaskBatches(signal: AbortSignal | undefined) {
  const changes = new Map<TaskId, "removed" | "updated">();

  let wake: (() => void) | undefined;
  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };

  const mark = (taskId: TaskId, change: "removed" | "updated") => {
    changes.set(taskId, change);
    notify();
  };

  const unsubscribes = [
    publisher.subscribe("task.updated", (payload) => {
      mark(payload.id, "updated");
    }),
    publisher.subscribe("task.removed", (payload) => {
      mark(payload.id, "removed");
    }),
  ];

  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
    signal?.removeEventListener("abort", close);
    notify();
  };

  // An abort listener on an already-aborted signal never fires.
  if (signal?.aborted) {
    close();
  } else {
    signal?.addEventListener("abort", close, { once: true });
  }

  return new AsyncIteratorClass<ChangedTaskBatch, void>(
    async () => {
      while (!closed) {
        if (changes.size === 0) {
          // The executor runs synchronously, so `wake` is set before any event
          // can fire; no wake-up is lost between the emptiness check and the
          // await.
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const batch: ChangedTaskBatch = {
          removed: new Set(),
          updated: new Set(),
        };
        for (const [taskId, change] of changes) {
          batch[change].add(taskId);
        }
        changes.clear();
        return { done: false, value: batch };
      }
      return { done: true, value: undefined };
    },
    () => {
      close();
      return Promise.resolve();
    },
  );
}
