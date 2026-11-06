import { getWorkspaceConfig } from "../workspace-config";

/**
 * Whether the person lets the chat's agent hear what they did in the app,
 * read fresh each time: off, no message carries the note and
 * `instrument activity` refuses.
 */
export function mayShareActions(): boolean {
  return getWorkspaceConfig().mayShareActions?.() ?? true;
}

/** Why `instrument activity` lists nothing while the person keeps it to themselves. */
export const ACTIONS_NOT_SHARED =
  "the user turned this off in Settings › Activity, so what they do in the app is not shared.";
