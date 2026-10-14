import { AsyncIteratorClass } from "@orpc/server";

import { publisher } from "../rpc/publisher";
import { type ChatId } from "../schemas/chat-id";
import { type StoreId } from "../schemas/store-id";
import { StorageKey } from "./storage-key";

/**
 * What moved in a record:
 *
 * - `messages`: a message or part of its transcript was written or removed.
 * - `session`: a session record, or something a session keeps beside its
 *   transcript (its browser state, the baselines a turn is diffed against).
 * - `settings`: the top level of its `settings.json`, what the app knows
 *   about it (title, apps, stamps).
 * - `state`: where the user left off in it (the `state` half of the same
 *   file, and its seen mark in the window's).
 * - `agent`: its agent started, moved between states, ended, or was held
 *   from starting or let go.
 * - `removed`: it is gone, with everything in it.
 */
export type RecordChange =
  | "agent"
  | "messages"
  | "removed"
  | "session"
  | "settings"
  | "state";

/** One change to one chat. */
export interface RecordChanged {
  id: ChatId;
  kind: RecordChange;
  /**
   * On a write to a transcript, the message it was to, and whether it took
   * the message out: what a live transcript re-reads by.
   */
  message?: {
    id: StoreId.Message;
    removed: boolean;
    sessionId: StoreId.Session;
  };
}

/** Says that something about a record moved. */
export function recordChanged(
  id: ChatId,
  kind: Exclude<RecordChange, "removed">,
): void {
  publisher.publish("record.changed", { id, kind });
}

/**
 * Says that a message of a transcript, or one of its parts, changed, naming
 * the message and whether it was taken out.
 */
export function recordMessageChanged(
  id: ChatId,
  message: NonNullable<RecordChanged["message"]>,
): void {
  publisher.publish("record.changed", { id, kind: "messages", message });
}

/** Says that a chat is gone, once the index has forgotten it. */
export function recordRemoved(id: ChatId): void {
  publisher.publish("record.changed", { id, kind: "removed" });
}

/**
 * Says what a write to one key of a chat's store changed, once it has
 * landed: its transcript, naming the message, or what its sessions keep.
 */
export function recordStoreWrite(
  id: ChatId,
  key: string,
  { removed }: { removed: boolean },
): void {
  if (!key.startsWith("messages:") && !key.startsWith("parts:")) {
    publisher.publish("record.changed", { id, kind: "session" });
    return;
  }
  const message = StorageKey.messageOf(key);
  publisher.publish("record.changed", {
    id,
    kind: "messages",
    ...(message && {
      message: {
        id: message.id,
        removed: removed && message.ownRow,
        sessionId: message.sessionId,
      },
    }),
  });
}

/**
 * Every record change since the consumer last pulled, one batch per pull,
 * each change once however often it happened. A callback subscription
 * hears every change as it is published, so nothing is dropped behind a
 * slow consumer, and the subscription is made when this is called rather
 * than on the first pull: a read taken right after has nothing land
 * unheard between the two. Ends when `signal` aborts or the iterator is
 * returned.
 */
export function recordChanges(
  signal: AbortSignal | undefined,
  keep: (change: RecordChanged) => boolean = () => true,
) {
  const pending = new Map<string, RecordChanged>();
  let wake: (() => void) | undefined;
  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };
  const unsubscribe = publisher.subscribe("record.changed", (change) => {
    if (keep(change)) {
      pending.set(`${change.id}\n${change.kind}`, change);
      notify();
    }
  });

  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe();
    signal?.removeEventListener("abort", close);
    notify();
  };
  // An abort listener on an already-aborted signal never fires.
  if (signal?.aborted) {
    close();
  } else {
    signal?.addEventListener("abort", close, { once: true });
  }

  return new AsyncIteratorClass<RecordChanged[], void>(
    async () => {
      while (!closed) {
        if (pending.size === 0) {
          // Set synchronously, so no change lands between the check and the wait.
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        const batch = [...pending.values()];
        pending.clear();
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
