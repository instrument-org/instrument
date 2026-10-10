import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

export function useTaskActivity({ id }: { id: ChatId }) {
  return useQuery({
    ...rpcClient.workspace.task.live.activity.experimental_liveOptions(),
    select: (activity) => activity.find((entry) => entry.taskId === id),
  });
}
