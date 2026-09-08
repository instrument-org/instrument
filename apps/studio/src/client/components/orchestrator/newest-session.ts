import { rpcClient } from "@/client/rpc/client";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import ms from "ms";

/** How often a task's sessions are re-read while it is open. */
const REFRESH_MS = ms("2 seconds");

/**
 * The session a task is talking in: ids are ulids, so the last one
 * alphabetically. The transcript and the menu above it both need it, and a
 * transcript whose menu acts on another session is the one thing they cannot do.
 */
export function useNewestSessionId(
  taskId: TaskId,
): StoreId.Session | undefined {
  const sessions = useQuery(
    rpcClient.workspace.session.list.queryOptions({
      input: { id: taskId },
      refetchInterval: REFRESH_MS,
    }),
  );
  return sessions.data
    ?.map((session) => session.id)
    .toSorted()
    .at(-1);
}
