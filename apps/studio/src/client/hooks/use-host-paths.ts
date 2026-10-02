import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { unique } from "radashi";

/**
 * Where the files a task named sit on the computer, by the path the task
 * wrote: the translation every person-facing surface makes once, on the way
 * to the screen, since a viewer reads by the real path and a tab is addressed
 * by one. A path the task cannot reach maps to null; a path not yet answered
 * is absent, and a surface draws it once it is.
 *
 * Asked for the whole surface at once rather than per file, against one
 * reading of the task's layout. The answer from the last set stays up while
 * a larger one is asked for, so a transcript that grows does not blink.
 */
export function useHostPaths(
  taskId: TaskId | undefined,
  filePaths: readonly string[],
): Record<string, null | string> {
  const asked = unique(filePaths).toSorted();
  const { data } = useQuery(
    taskId !== undefined && asked.length > 0
      ? rpcClient.workspace.task.files.hostPaths.queryOptions({
          input: { filePaths: asked, taskId },
          placeholderData: keepPreviousData,
          refetchOnWindowFocus: false,
        })
      : // Nothing to ask, and nothing to reach for: a surface outside a task
        // renders without a client that knows the workspace at all.
        { queryFn: skipToken, queryKey: ["host-paths", "nothing"] },
  );
  return data ?? {};
}
