import { type StoreId } from "../schemas/store-id";

/**
 * Waits a session's agent is sitting in, so a message that arrives for it can
 * end them. A steer is heard at the agent's next step, and a step that is a
 * ten-minute `fg` puts the message ten minutes away; the wait is not work, so
 * ending it early loses nothing and delivers the message now. A foreground
 * `bash` command is a wait of the same kind: the command moves to the
 * background and keeps running, and only the call waiting on it ends.
 *
 * Process-local, like the background process registry the waits belong to.
 */
const waitsBySession = new Map<StoreId.Session, Set<AbortController>>();

/**
 * Who wrote the message that ended a wait, carried as the signal's `reason`:
 * the person typing into the chat, or anything else (the chat writing to its
 * task, a task's finish waking the chat).
 */
export type WaitInterrupt = { from: "other" | "user" };

/**
 * A signal that fires, with a `WaitInterrupt` as its reason, when a message
 * arrives for the session; release when the wait ends.
 */
export function interruptibleWait(sessionId: StoreId.Session): {
  release: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const waits = waitsBySession.get(sessionId) ?? new Set();
  waits.add(controller);
  waitsBySession.set(sessionId, waits);
  return {
    release: () => {
      waits.delete(controller);
      if (waits.size === 0) {
        waitsBySession.delete(sessionId);
      }
    },
    signal: controller.signal,
  };
}

/** Ends every wait the session's agent is in; called when a message arrives for it. */
export function interruptWaits(
  sessionId: StoreId.Session,
  interrupt: WaitInterrupt,
): void {
  const waits = waitsBySession.get(sessionId);
  if (!waits) {
    return;
  }
  for (const controller of waits) {
    controller.abort(interrupt);
  }
  waitsBySession.delete(sessionId);
}

/** Whether the person typed the message that ended a wait. */
export function interruptedByUser(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason;
  return (
    typeof reason === "object" &&
    reason !== null &&
    "from" in reason &&
    reason.from === "user"
  );
}
