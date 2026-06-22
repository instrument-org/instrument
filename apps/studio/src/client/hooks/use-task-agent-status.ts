import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useQuery } from "@tanstack/react-query";

export function useTaskAgentStatus({ id }: { id: TaskId | typeof skipToken }) {
  return useQuery(
    rpcClient.workspace.task.agentStatus.live.byId.experimental_liveOptions({
      input: id === skipToken ? skipToken : { id },
    }),
  );
}
