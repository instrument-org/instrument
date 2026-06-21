import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { type SessionMessageDataPart, type TaskId } from "@instrument-org/workspace/client";

import { FilesGrid } from "./files-grid";

export function FileChangesCard({
  assetBaseUrl,
  className,
  files,
  projectSubdomain,
}: {
  assetBaseUrl: string;
  className?: string;
  files: SessionMessageDataPart.FileChangeDataPartItem[];
  projectSubdomain: TaskId;
}) {
  // Deleted files have nothing to preview; show the ones that still exist.
  const currentFiles: ProjectFileViewerFile[] = files
    .filter((file) => file.status !== "deleted")
    .map((file) => ({
      filename: file.filename,
      filePath: file.filePath,
      mimeType: file.mimeType,
      modifiedAt: file.modifiedAt,
      projectSubdomain,
      url: getAssetUrl({
        assetBase: assetBaseUrl,
        filePath: file.filePath,
        version: file.modifiedAt,
      }),
    }));

  if (currentFiles.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <FilesGrid files={currentFiles} initialVisibleCount={4} />
    </div>
  );
}
