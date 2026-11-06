import { useHostPaths } from "@/client/hooks/use-host-paths";
import { useShowChatFile } from "@/client/hooks/use-show-chat-file";
import { getComputerFileUrl } from "@/client/lib/computer-file-url";
import {
  type SessionMessageDataPart,
  CHAT_FOLDER_NAMES,
  type ChatId,
} from "@instrument-org/workspace/client";

import { AttachedFilePreview } from "./attached-file-preview";

// TODO(2026-07-23): legacy attachment-path normalization, added 2026-06-23.
// Pre-`attachments/` tasks stored upload paths as `./user-provided/…` or
// `./agent-retrieved/…` in message file parts. The workspace-layout migration
// moved the files into `attachments/` but left those stored paths stale, so
// their host paths never resolved and nothing was drawn for them. Remap to
// the current location for display.
const LEGACY_ATTACHMENT_DIR_PREFIXES = ["user-provided/", "agent-retrieved/"];

/**
 * The files a sent message carried, as the chips the composer gave them, in
 * the order they were attached: a picture's own thumbnail or the file's type,
 * and its name. A press opens it in the chat's pane, a picture large.
 */
export function SentFileChips({
  chatId,
  files,
}: {
  chatId: ChatId;
  files: SessionMessageDataPart.FileAttachmentDataPart[];
}) {
  const showChatFile = useShowChatFile();
  const attachments = files.map((file) => ({
    ...file,
    filePath: normalizeAttachmentFilePath(file.filePath),
  }));
  const hostPaths = useHostPaths(
    chatId,
    attachments.map((file) => file.filePath),
  );
  return attachments.flatMap((file) => {
    const hostPath = hostPaths[file.filePath];
    if (!hostPath) {
      return [];
    }
    return [
      <AttachedFilePreview
        filename={file.filename}
        hostPath={hostPath}
        key={file.filePath}
        mimeType={file.mimeType}
        onClick={() => {
          showChatFile(file.filePath);
        }}
        url={getComputerFileUrl({ hostPath, version: file.modifiedAt })}
      />,
    ];
  });
}

function normalizeAttachmentFilePath(filePath: string): string {
  const bare = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  const legacyPrefix = LEGACY_ATTACHMENT_DIR_PREFIXES.find((prefix) =>
    bare.startsWith(prefix),
  );
  return legacyPrefix
    ? `${CHAT_FOLDER_NAMES.attachments}/${bare.slice(legacyPrefix.length)}`
    : bare;
}
