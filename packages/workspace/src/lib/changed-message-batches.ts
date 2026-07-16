import { AsyncIteratorClass } from "@orpc/server";

import { publisher } from "../rpc/publisher";
import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

export interface ChangedMessageBatch {
  removed: Set<StoreId.Message>;
  updated: Set<StoreId.Message>;
}

// Folds message/part events into a deduped map of changed message ids and
// yields one batch per drain. Callback subscriptions capture every event
// synchronously at publish time, so nothing is lost to the publisher's
// single-event buffer, and a burst collapses into one batch because the
// consumer only pulls the next batch after it finishes the current one.
// Subscriptions register when this function is called (not on the first
// pull), so a caller can subscribe before taking an initial snapshot and no
// event lands unobserved in between. Scoped to this session so a token
// streaming elsewhere doesn't wake this subscription: message.updated/
// .removed carry messageId/sessionId directly; part.updated carries both on
// the part. Tears down on signal abort or on iterator return/throw; either
// path unsubscribes and settles a pending pull with done.
export function changedMessageBatches(
  input: { id: TaskId; sessionId: StoreId.Session },
  signal: AbortSignal | undefined,
) {
  const changes = new Map<StoreId.Message, "removed" | "updated">();

  let wake: (() => void) | undefined;
  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };

  const mark = (messageId: StoreId.Message, change: "removed" | "updated") => {
    changes.set(messageId, change);
    notify();
  };

  const unsubscribes = [
    publisher.subscribe("message.updated", (payload) => {
      if (payload.id === input.id && payload.sessionId === input.sessionId) {
        mark(payload.messageId, "updated");
      }
    }),
    publisher.subscribe("message.removed", (payload) => {
      if (payload.id === input.id && payload.sessionId === input.sessionId) {
        mark(payload.messageId, "removed");
      }
    }),
    publisher.subscribe("part.updated", (payload) => {
      const { messageId, sessionId } = payload.part.metadata;
      if (payload.id === input.id && sessionId === input.sessionId) {
        mark(messageId, "updated");
      }
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

  return new AsyncIteratorClass<ChangedMessageBatch, void>(
    async () => {
      while (!closed) {
        if (changes.size === 0) {
          // The executor runs synchronously, so `wake` is set before any
          // event can fire; no wake-up is lost between the emptiness check
          // and the await.
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const batch: ChangedMessageBatch = {
          removed: new Set(),
          updated: new Set(),
        };
        for (const [messageId, change] of changes) {
          batch[change].add(messageId);
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
