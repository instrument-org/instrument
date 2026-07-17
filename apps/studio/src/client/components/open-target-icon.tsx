import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";

import { FileIcon } from "./file-icon";
import { IconWithFallback } from "./icon-with-fallback";

// Icon of the default app for the file, with a file-type fallback when the
// platform can't resolve an app icon or the cached icon fails to load.
export function OpenTargetIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<TaskFileViewerFile, "filePath" | "taskId">;
}) {
  const { iconUrl } = useTaskFileOpenTarget(file);
  const filename = file.filePath.split("/").pop() ?? file.filePath;

  return (
    <IconWithFallback
      className={className}
      fallback={<FileIcon className={className} filename={filename} />}
      src={iconUrl}
    />
  );
}
