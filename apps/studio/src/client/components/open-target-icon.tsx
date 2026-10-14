import { type ViewerFile } from "@/client/atoms/viewer-file";
import { useFileOpenTarget } from "@/client/hooks/use-file-open-target";

import { FileTypeIcon } from "./extend/file-system";
import { IconWithFallback } from "./icon-with-fallback";
import { nameOf } from "./window/host-path";

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
  const filename = nameOf(file.hostPath);

  return (
    <IconWithFallback
      className={className}
      fallback={<FileTypeIcon className={className} fileName={filename} />}
      src={iconUrl}
    />
  );
}
