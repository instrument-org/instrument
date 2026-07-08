import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";

// Icon of the default app for the file (file-type icon where the platform
// can't resolve the app), with a generic open icon as fallback.
export function OpenTargetIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<TaskFileViewerFile, "filePath" | "taskId">;
}) {
  const { iconDataUrl } = useTaskFileOpenTarget(file);

  if (!iconDataUrl) {
    return <ArrowSquareOutIcon className={className} />;
  }

  return (
    <img alt="" className={className} draggable={false} src={iconDataUrl} />
  );
}
