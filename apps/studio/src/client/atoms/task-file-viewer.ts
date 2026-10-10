import { type ChatId } from "@instrument-org/workspace/client";

/**
 * A file some surface is offering to show or act on, by where it is on the
 * computer: the viewer reads its bytes by that path and every action (open,
 * reveal, copy, drag) acts on it. A file a task named arrives in the task's
 * own terms and is translated to this once, on its way to the screen.
 *
 * `mimeType` and `modifiedAt` arrive when something actually resolved the file
 * against disk, as the artifact panel does because it is about to read the
 * bytes, and are absent everywhere else.
 */
export interface ViewerFile {
  filename: string;
  hostPath: string;
  mimeType?: string;
  modifiedAt?: number;
  /**
   * The path the task wrote for it, with the task, when it came from one.
   * The task page addresses its panes by that path and a mention in the
   * composer names the file the way the agent knows it.
   */
  taskFile?: { filePath: string; chatId: ChatId };
  url: string;
}
