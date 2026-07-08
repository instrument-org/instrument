import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery } from "@tanstack/react-query";

// Default-app name and icon for a task file, for "Open in {app}" affordances.
// Resolution is cached per file type in the main process; the query itself is
// cached per file here.
export function useTaskFileOpenTarget(
  file: Pick<TaskFileViewerFile, "filePath" | "taskId"> | undefined,
) {
  const { data } = useQuery(
    rpcClient.utils.getTaskFileOpenTarget.queryOptions({
      input: file ? { filePath: file.filePath, id: file.taskId } : skipToken,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );

  const appName = data?.appName ?? null;

  return {
    appName,
    iconDataUrl: data?.iconDataUrl ?? null,
    openLabel: appName ? `Open in ${appName}` : "Open",
  };
}
