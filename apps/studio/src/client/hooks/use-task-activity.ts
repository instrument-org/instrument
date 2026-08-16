import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

export function useTaskActivity({ id }: { id: TaskId }) {
  return useQuery({
    ...rpcClient.workspace.task.live.activity.experimental_liveOptions(),
    select: (activity) => activity.find((entry) => entry.taskId === id),
  });
}
