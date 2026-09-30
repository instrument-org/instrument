import { hasLiveAgent } from "@/client/lib/agent-status";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often a task's standing is re-read while it is on screen. */
const REFRESH_MS = ms("2 seconds");

/**
 * Whether the task has an agent at work, re-read while it is on screen. The
 * task page's header and its transcript ask with the same query, so they agree.
 */
export function useIsTaskWorking(taskId: TaskId) {
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: { ids: [taskId] },
      refetchInterval: REFRESH_MS,
    }),
  );
  return status.data?.some(hasLiveAgent) ?? false;
}

/**
 * Why the task has not started yet, in the user's words, while something holds
 * it from starting; re-read while it is on screen. The same query the task's
 * card in the chat follows, so the two say the same thing.
 */
export function useTaskHold(taskId: TaskId) {
  const status = useQuery(
    rpcClient.workspace.chats.taskStatus.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  return status.data?.held;
}
