import { type StoreId } from "../schemas/store-id";
import { type TaskId } from "../schemas/task-id";

interface ActiveReplay {
  controller: AbortController;
  id: TaskId;
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
  getActiveSessionIds(id: TaskId): StoreId.Session[] {
    const result: StoreId.Session[] = [];
    for (const [sessionId, entry] of activeReplays) {
      if (entry.id === id) {
        result.push(sessionId);
      }
    }
    return result;
  },
  getActiveSessions() {
    return [...activeReplays].map(([sessionId, entry]) => ({
      id: entry.id,
      sessionId,
    }));
  },
  getTaskId(sessionId: StoreId.Session): TaskId | undefined {
    return activeReplays.get(sessionId)?.id;
  },
  isActive(sessionId: StoreId.Session) {
    return activeReplays.has(sessionId);
  },
  register(
    sessionId: StoreId.Session,
    controller: AbortController,
    id: TaskId,
  ) {
    activeReplays.set(sessionId, { controller, id });
    controller.signal.addEventListener("abort", () => {
      activeReplays.delete(sessionId);
    });
  },
};
