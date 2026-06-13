import { type ProjectFileViewerFile } from "@/client/atoms/project-file-viewer";
import { getAssetUrl } from "@/client/lib/get-asset-url";
import { cn } from "@/client/lib/utils";
import {
  type ProjectSubdomain,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { FileTextIcon } from "@phosphor-icons/react";

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
  projectSubdomain: ProjectSubdomain;
}) {
  if (files.length === 0) {
    return null;
  }

  const currentFiles: ProjectFileViewerFile[] = files
    .filter((file) => file.status !== "deleted")
    .map((file) => ({
      filename: file.filename,
      filePath: file.filePath,
      mimeType: file.mimeType,
      projectSubdomain,
      url: getAssetUrl({
        assetBase: assetBaseUrl,
        filePath: file.filePath,
      }),
    }));

  const addedCount = files.filter((file) => file.status === "added").length;
  const modifiedCount = files.filter(
    (file) => file.status === "modified",
  ).length;
  const deletedCount = files.filter((file) => file.status === "deleted").length;
  const summary = [
    countLabel(addedCount, "added"),
    countLabel(modifiedCount, "modified"),
    countLabel(deletedCount, "deleted"),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileTextIcon className="size-4 text-muted-foreground" />
        <span>
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
      </div>
      {summary && (
        <div className="text-xs text-muted-foreground">{summary}</div>
      )}
      {currentFiles.length > 0 && (
        <FilesGrid compact files={currentFiles} initialVisibleCount={4} />
      )}
    </div>
  );
}

function countLabel(count: number, label: string) {
  if (count === 0) {
    return "";
  }
  return `${count} ${label}`;
}
