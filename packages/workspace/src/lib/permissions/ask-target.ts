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

/** A page's site as a line names it, its host without `www.`; undefined for no address or one with no host. */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || undefined;
  } catch {
    return undefined;
  }
}
