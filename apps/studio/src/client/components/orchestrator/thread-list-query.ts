import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { skipToken } from "@tanstack/react-query";

/**
 * The orchestrator's live thread list, with what every reader of it shares:
 * a thread that did not change keeps its object across updates, dates and
 * all, so the rows memoized on it stay put when another thread moves. Every
 * reader passes the same options, since the one query holds one set.
 */
export function threadListOptions(taskId: TaskId | undefined) {
  return rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
    {
      input: taskId ? { id: taskId } : skipToken,
      structuralSharing: shareEqualDeep,
    },
  );
}
