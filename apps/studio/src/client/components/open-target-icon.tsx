import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useTaskFileOpenTarget } from "@/client/hooks/use-task-file-open-target";
import { cn } from "@/client/lib/utils";

import { FileIcon } from "./file-icon";

// Icon of the default app for the file. While the app is still resolving it
// renders an invisible box of the same size (so it appears only once ready,
// with no jarring placeholder), and falls back to the file-type icon when the
// platform can't resolve an app.
export function OpenTargetIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<TaskFileViewerFile, "filePath" | "taskId">;
}) {
  const { iconDataUrl, isPending } = useTaskFileOpenTarget(file);

  if (iconDataUrl) {
    return (
      <img alt="" className={className} draggable={false} src={iconDataUrl} />
    );
  }

  if (isPending) {
    return <span aria-hidden className={cn("inline-block", className)} />;
  }

  const filename = file.filePath.split("/").pop() ?? file.filePath;
  return <FileIcon className={className} filename={filename} />;
}
