import { folderNameFromPath } from "@instrument-org/shared";

import { type PermissionAsk } from "../../schemas/chat-state";

/**
 * The folder or app an ask is about, as a line names it: a folder's name in
 * curly quotes, as a name the person chose, and an app's name as the app
 * calls itself.
 */
export function askTargetName(
  kind: PermissionAsk["kind"],
  target: string,
): string {
  return kind === "folder" ? `“${folderNameFromPath(target)}”` : target;
}
