import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";

import { FileIcon } from "./file-icon";

// Icon of the default app for the file, with a file-type fallback when the
// platform can't resolve an app icon.
export function OpenTargetIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<TaskFileViewerFile, "filePath" | "taskId">;
}) {
  const { iconDataUrl } = useTaskFileOpenTarget(file);

  if (iconDataUrl) {
    return (
      <img alt="" className={className} draggable={false} src={iconDataUrl} />
    );
  }

  const filename = file.filePath.split("/").pop() ?? file.filePath;
  return <FileIcon className={className} filename={filename} />;
}
