import {
  orchestratorRecentsAtom,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";

import { type ActivityRow, mergeRows, visitsOf } from "./activity";
import { type Topic } from "./threads";

/**
 * What Activity is made of: the threads' entries as the workspace reads them
 * out of the threads' messages, kept live, merged with the visits this window
 * remembers showing, which the workspace never sees; and the topics, for the
 * marks on each row. Read once by whichever surface draws the list.
 */
export function useActivity(taskId: TaskId): {
  /** Whether the threads' entries are still on their way. */
  isLoading: boolean;
  rows: ActivityRow[];
  topics: Topic[];
} {
  const log = useQuery(
    rpcClient.workspace.orchestrator.activityLog.live.list.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const topics = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: { id: taskId },
    }),
  );
  const recents = useAtomValue(orchestratorRecentsAtom);
  const pages = useAtomValue(visitedPagesAtom);
  return {
    isLoading: log.data === undefined,
    rows: mergeRows(log.data ?? [], visitsOf(recents, pages)),
    topics: topics.data ?? [],
  };
}
