import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";

import { isMacOS } from "../lib/utils";

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

const openTargetQueryOptions = (file: FileRef | undefined) =>
  rpcClient.utils.getTaskFileOpenTarget.queryOptions({
    input: file ? { filePath: file.filePath, id: file.taskId } : skipToken,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

// Warms the open-target query (e.g. on hover) so menus and the file viewer
// have the app name and icon ready by the time they render.
export function usePrefetchTaskFileOpenTarget() {
  const queryClient = useQueryClient();
  return (file: FileRef) => {
    void queryClient.prefetchQuery(openTargetQueryOptions(file));
  };
}

// Every app that can open the file (default first). File viewers start this
// lookup immediately; contextual menus wait until opened.
export function useTaskFileOpenCandidates(
  file: FileRef | undefined,
  { enabled }: { enabled: boolean },
) {
  const { data, isError, isPending } = useQuery(
    rpcClient.utils.getTaskFileOpenCandidates.queryOptions({
      input:
        enabled && file
          ? { filePath: file.filePath, id: file.taskId }
          : skipToken,
      // A successful list is cached for the session, but a failed lookup is
      // worth another attempt whenever a menu that needs it mounts.
      refetchOnMount: (query) => query.state.status === "error",
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );

  return {
    apps: data?.apps ?? [],
    isError,
    isPending: enabled && file != null && isPending,
  };
}

// Default-app name and icon for a task file, for "Open in {app}" affordances.
// Resolution is cached per file type in the main process (and persisted across
// runs); the query is cached per file here.
export function useTaskFileOpenTarget(file: FileRef | undefined) {
  const { data, isPending } = useQuery(openTargetQueryOptions(file));

  const appName = data?.appName ?? null;
  const showOpen = file != null && !isPending && appName != null;

  return {
    appName,
    iconUrl: data?.iconUrl ?? null,
    isPending,
    openLabel: appName ? `Open in ${appName}` : "Open",
    showOpen,
    showOpenWith: showOpen && isMacOS(),
  };
}
