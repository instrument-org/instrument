import { type MountedFolder } from "../../schemas/mounted-folder";
import { type ChatId } from "../../schemas/chat-id";
import { chatDir } from "../../lib/record-folders";
import { buildWorkspaceFsLayout } from "../../lib/workspace-fs-layout";

/** The layout a task's shell has, with the folders given mounted beside it. */
export function taskLayout(
  chatId: ChatId,
  folders?: Record<string, MountedFolder.Type>,
) {
  return buildWorkspaceFsLayout({
    ...(folders ? { folders } : {}),
    taskHostRoot: chatDir(chatId),
  });
}
