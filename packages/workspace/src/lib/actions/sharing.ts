import { getWorkspaceConfig } from "../workspace-config";

/**
 * Whether the person lets the chat's agent hear what they did in the app,
 * read fresh each time: off, no message carries the note and
 * `instrument activity` refuses.
 */
export function mayShareActions(): boolean {
  return getWorkspaceConfig().mayShareActions?.() ?? true;
}

/** Why `instrument activity`, `window history` and `window sites` refuse while the person keeps what they do to themselves. */
export const ACTIONS_NOT_SHARED =
  'the user turned off "Chats can see this" in Settings › History, so what they do in the app is not shared. They can turn it back on there.';
