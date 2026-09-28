import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { useOrchestrator } from "./context";

/** Each task's title by its id, for a tab standing on one, read from the same list the tasks screens keep fresh. */
export function useTaskTitles(): Map<TaskId, string> {
  const orchestrator = useOrchestrator();
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: { id: orchestrator.taskId },
    }),
  );
  return new Map(children.data?.map((child) => [child.id, child.title]) ?? []);
}
