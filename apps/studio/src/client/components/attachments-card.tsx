import { getAssetUrl } from "@/client/lib/get-asset-url";
import {
  type SessionMessageDataPart,
  TASK_FOLDER_NAMES,
  type TaskId,
} from "@instrument-org/workspace/client";

import { FilesGrid } from "./files-grid";

// TODO(2026-07-23): legacy attachment-path normalization, added 2026-06-23.
// Pre-`attachments/` tasks stored upload paths as `./user-provided/…` or
// `./agent-retrieved/…` in message file parts. The workspace-layout migration
// moved the files into `attachments/` but left those stored paths stale, so
// FilesGrid (which buckets by the `attachments/` prefix) dropped them and the
// card rendered nothing. Remap to the current location for display.
const LEGACY_ATTACHMENT_DIR_PREFIXES = ["user-provided/", "agent-retrieved/"];

interface FileAttachmentsCardProps {
  assetBaseUrl: string;
  files: SessionMessageDataPart.FileAttachmentDataPart[];
  taskId: TaskId;
}

export function AttachmentsCard({
  assetBaseUrl,
  files,
  taskId,
}: FileAttachmentsCardProps) {
  const fileItems = files.map((file) => {
    const filePath = normalizeAttachmentFilePath(file.filePath);
    // Legacy parts predate the required modifiedAt field; the schema types it as
    // a number but the stored value can be absent at runtime. Fall back to 0 so
    // the artifactPanel search schema (which requires a number) accepts a click.
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime value can be absent despite the type
    const modifiedAt = file.modifiedAt ?? 0;
    return {
      filename: file.filename,
      filePath,
      mimeType: file.mimeType,
      modifiedAt,
      size: file.size,
      taskId,
      url: getAssetUrl({
        assetBase: assetBaseUrl,
        filePath,
        version: modifiedAt,
      }),
    };
  });

  // In attach order, not bucketed: this is the set the user picked, and a file
  // they attached from somewhere the buckets do not cover would be dropped from
  // a card whose whole job is to show what they sent.
  return <FilesGrid alignEnd compact files={fileItems} preserveOrder />;
}

function normalizeAttachmentFilePath(filePath: string): string {
  const bare = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const legacyPrefix = LEGACY_ATTACHMENT_DIR_PREFIXES.find((prefix) =>
    bare.startsWith(prefix),
  );
  return legacyPrefix
    ? `${TASK_FOLDER_NAMES.attachments}/${bare.slice(legacyPrefix.length)}`
    : bare;
}
