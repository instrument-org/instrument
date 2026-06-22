import { getAssetUrl } from "@/client/lib/get-asset-url";
import {
  type SessionMessageDataPart,
  type TaskId,
} from "@instrument-org/workspace/client";

import { FilesGrid } from "./files-grid";

interface FileAttachmentsCardProps {
  assetBaseUrl: string;
  files: SessionMessageDataPart.FileAttachmentDataPart[];
  folders?: SessionMessageDataPart.FolderAttachmentDataPart[];
  taskId: TaskId;
}

export function AttachmentsCard({
  assetBaseUrl,
  files,
  folders,
  taskId,
}: FileAttachmentsCardProps) {
  const fileItems = files.map((file) => ({
    filename: file.filename,
    filePath: file.filePath,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedAt,
    size: file.size,
    taskId,
    url: getAssetUrl({
      assetBase: assetBaseUrl,
      filePath: file.filePath,
      version: file.modifiedAt,
    }),
  }));

  return (
    <FilesGrid
      alignEnd
      compact
      files={fileItems}
      folders={folders}
      prioritizeUserFiles
    />
  );
}
