import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

/**
 * Where a task stands, kept current by the workspace as it moves rather than
 * asked for again on a timer: whether it works, what holds it, the step it
 * is on, the session it talks in. Every reader of one task passes the same
 * options, so they share one subscription and agree.
 */
export function taskStatusOptions(taskId: TaskId) {
  return rpcClient.workspace.task.live.status.experimental_liveOptions({
    input: { id: taskId },
  });
}

/** The task's status; none until the first answer lands. */
export function useTaskStatus(taskId: TaskId) {
  return useQuery(taskStatusOptions(taskId)).data;
}

/** Whether the task has an agent at work. */
export function useIsTaskWorking(taskId: TaskId) {
  return useTaskStatus(taskId)?.isWorking ?? false;
}

/** Why the task has not started yet, in the user's words, while something holds it. */
export function useTaskHold(taskId: TaskId) {
  return useTaskStatus(taskId)?.held;
}
