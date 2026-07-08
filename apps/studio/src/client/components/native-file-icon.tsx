import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { rpcClient } from "@/client/rpc/client";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

// The OS icon for the app associated with the file type, with a generic
// open icon as fallback while loading or when the platform has none.
export function NativeFileIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<TaskFileViewerFile, "filePath" | "taskId">;
}) {
  const { data } = useQuery(
    rpcClient.utils.getTaskFileIcon.queryOptions({
      input: { filePath: file.filePath, id: file.taskId },
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );

  if (!data) {
    return <ArrowSquareOutIcon className={className} />;
  }

  return (
    <img alt="" className={className} draggable={false} src={data.dataUrl} />
  );
}
