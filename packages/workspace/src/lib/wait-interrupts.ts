import { type StoreId } from "../schemas/store-id";

/**
 * Waits a session's agent is sitting in, so a message that arrives for it can
 * end them. A steer is heard at the agent's next step, and a step that is a
 * ten-minute `fg` puts the message ten minutes away; the wait is not work, so
 * ending it early loses nothing and delivers the message now.
 *
 * Process-local, like the background process registry the waits belong to.
 */
const waitsBySession = new Map<StoreId.Session, Set<AbortController>>();

/** A signal that fires when a message arrives for the session; release when the wait ends. */
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
export function interruptWaits(sessionId: StoreId.Session): void {
  const waits = waitsBySession.get(sessionId);
  if (!waits) {
    return;
  }
  for (const controller of waits) {
    controller.abort();
  }
  waitsBySession.delete(sessionId);
}
