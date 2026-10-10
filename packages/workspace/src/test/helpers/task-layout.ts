import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type ChatId } from "../../schemas/chat-id";
import { chatDir } from "../../lib/record-folders";
import { buildWorkspaceFsLayout } from "../../lib/workspace-fs-layout";

/** The layout a task's shell has, with the folders given mounted beside it. */
export function taskLayout(
  taskId: ChatId,
  attachedFolders?: Record<string, FolderAttachment.Type>,
) {
  return buildWorkspaceFsLayout({
    ...(attachedFolders ? { attachedFolders } : {}),
    taskHostRoot: chatDir(taskId),
  });
}
