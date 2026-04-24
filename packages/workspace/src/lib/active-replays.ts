import { type StoreId } from "../schemas/store-id";

const activeReplays = new Map<StoreId.Session, AbortController>();

export const ActiveReplays = {
  cancel(sessionId: StoreId.Session) {
    const controller = activeReplays.get(sessionId);
    if (controller) {
      controller.abort();
      activeReplays.delete(sessionId);
    }
  },
  isActive(sessionId: StoreId.Session) {
    return activeReplays.has(sessionId);
  },
  register(sessionId: StoreId.Session, controller: AbortController) {
    activeReplays.set(sessionId, controller);
    controller.signal.addEventListener("abort", () => {
      activeReplays.delete(sessionId);
    });
  },
};
