import { getAssetUrl } from "@/client/lib/get-asset-url";
import {
  type ProjectSubdomain,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";

import { FilesGrid } from "./files-grid";

interface FileAttachmentsCardProps {
  assetBaseUrl: string;
  files: SessionMessageDataPart.FileAttachmentDataPart[];
  folders?: SessionMessageDataPart.FolderAttachmentDataPart[];
  projectSubdomain: ProjectSubdomain;
}

export function AttachmentsCard({
  assetBaseUrl,
  files,
  folders,
  projectSubdomain,
}: FileAttachmentsCardProps) {
  const fileItems = files.map((file) => ({
    filename: file.filename,
    filePath: file.filePath,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedAt,
    projectSubdomain,
    size: file.size,
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
