import { AsyncIteratorClass } from "@orpc/server";

import { publisher } from "../rpc/publisher";
import { type StoreId } from "../schemas/store-id";
import { type ChatId } from "../schemas/chat-id";

export interface ChangedMessageBatch {
  /** Whether the chat's agent started, moved or ended since the last batch. */
  agent: boolean;
  removed: Set<StoreId.Message>;
  updated: Set<StoreId.Message>;
}

// Folds the store's transcript writes (each a `record.changed` naming its
// message) into a deduped map of changed message ids and yields one batch
// per drain. A callback subscription captures every change synchronously at
// publish time, so nothing is lost to the publisher's single-event buffer,
// and a burst collapses into one batch because the consumer only pulls the
// next batch after it finishes the current one. The subscription registers
// when this function is called (not on the first pull), so a caller can
// subscribe before taking an initial snapshot and no change lands
// unobserved in between. Scoped to `input.sessionId` when given so a token
// streaming elsewhere doesn't wake this subscription; omit it to watch the
// whole chat (e.g. a chat-wide usage rollup). Tears down on signal abort or
// on iterator return/throw; either path unsubscribes and settles a pending
// pull with done.
export function changedMessageBatches(
  input: {
    /** Also wake when the chat's agent moves, for a reader that shows it. */
    agent?: boolean;
    /** One task, or a test every task's events are put to. */
    id: ((id: ChatId) => boolean) | ChatId;
    sessionId?: StoreId.Session;
  },
  signal: AbortSignal | undefined,
) {
  const matchesTask = (id: ChatId) =>
    typeof input.id === "function" ? input.id(id) : id === input.id;
  const changes = new Map<StoreId.Message, "removed" | "updated">();
  let agentMoved = false;

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

  const matchesSession = (sessionId: StoreId.Session) =>
    input.sessionId === undefined || sessionId === input.sessionId;

  const unsubscribes = [
    publisher.subscribe("record.changed", ({ id, kind, message }) => {
      if (message && matchesTask(id) && matchesSession(message.sessionId)) {
        mark(message.id, message.removed ? "removed" : "updated");
      } else if (input.agent && kind === "agent" && matchesTask(id)) {
        agentMoved = true;
        notify();
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
        if (changes.size === 0 && !agentMoved) {
          // The executor runs synchronously, so `wake` is set before any
          // event can fire; no wake-up is lost between the emptiness check
          // and the await.
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const batch: ChangedMessageBatch = {
          agent: agentMoved,
          removed: new Set(),
          updated: new Set(),
        };
        agentMoved = false;
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
