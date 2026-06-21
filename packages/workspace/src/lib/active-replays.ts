import {
  type StoreId,
} from "../schemas/store-id";
import {
  type TaskId,
} from "../schemas/task-id";

interface ActiveReplay {
  controller: AbortController;
  subdomain: TaskId;
}

const activeReplays = new Map<StoreId.Session, ActiveReplay>();

export const ActiveReplays = {
  cancel(sessionId: StoreId.Session) {
    const entry = activeReplays.get(sessionId);
    if (entry) {
      entry.controller.abort();
      activeReplays.delete(sessionId);
    }
  },
  getActiveSessionIds(subdomain: TaskId): StoreId.Session[] {
    const result: StoreId.Session[] = [];
    for (const [sessionId, entry] of activeReplays) {
      if (entry.subdomain === subdomain) {
        result.push(sessionId);
      }
    }
    return result;
  },
  getSubdomain(sessionId: StoreId.Session): TaskId | undefined {
    return activeReplays.get(sessionId)?.subdomain;
  },
  isActive(sessionId: StoreId.Session) {
    return activeReplays.has(sessionId);
  },
  register(
    sessionId: StoreId.Session,
    controller: AbortController,
    subdomain: TaskId,
  ) {
    activeReplays.set(sessionId, { controller, subdomain });
    controller.signal.addEventListener("abort", () => {
      activeReplays.delete(sessionId);
    });
  },
};
