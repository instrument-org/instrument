import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";

/**
 * The orchestrator's live thread list, with what every reader of it shares:
 * a thread that did not change keeps its object across updates, dates and
 * all, so the rows memoized on it stay put when another thread moves. Every
 * reader passes the same options, since the one query holds one set.
 */
export function threadListOptions() {
  return rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
    { structuralSharing: shareEqualDeep },
  );
}
