import { type ViewerFile } from "@/client/atoms/task-file-viewer";
import { useFileOpenTarget } from "@/client/hooks/use-file-open-target";

import { FileIcon } from "./file-icon";
import { IconWithFallback } from "./icon-with-fallback";

// Icon of the default app for the file, with a file-type fallback when the
// platform can't resolve an app icon or the cached icon fails to load.
export function OpenTargetIcon({
  className,
  file,
}: {
  className?: string;
  file: Pick<ViewerFile, "hostPath">;
}) {
  const { iconUrl } = useFileOpenTarget(file);
  const filename = file.hostPath.split(/[/\\]/).pop() ?? file.hostPath;

  return (
    <IconWithFallback
      className={className}
      fallback={<FileIcon className={className} filename={filename} />}
      src={iconUrl}
    />
  );
}
