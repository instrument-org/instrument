import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";

export function useTaskActivity({ id }: { id: TaskId }) {
  return useQuery({
    ...rpcClient.workspace.task.live.activity.experimental_liveOptions(),
    select: (activity) => activity.find((entry) => entry.taskId === id),
  });
}

export function useTaskAgentStatus({ id }: { id: TaskId | typeof skipToken }) {
  return useQuery({
    ...rpcClient.workspace.task.live.activity.experimental_liveOptions(),
    enabled: id !== skipToken,
    select: (activity) => {
      if (id === skipToken) {
        return;
      }

      const taskActivity = activity.find((entry) => entry.taskId === id);
      return {
        sessionActors: taskActivity?.sessionActors ?? [],
        taskId: id,
      };
    },
  });
}
