import { type StoreId, type TaskId } from "@instrument-org/workspace/client";

import { useTaskStatus } from "./task-working";

/**
 * The session a task is talking in, its newest. The transcript and the menu
 * above it both need it, and a transcript whose menu acts on another session
 * is the one thing they cannot do.
 */
export function useNewestSessionId(
  taskId: TaskId,
): StoreId.Session | undefined {
  return useTaskStatus(taskId)?.newestSessionId;
}
