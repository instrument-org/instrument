/**
 * Who stopped a session's turn, and whether its chat hears about it. Carried
 * on the stop and out again on `session.done`, so the turn the stop ended is
 * the one it describes.
 */
export interface StopNotice {
  /** The chat's `instrument task stop`, the user's Stop, or the app quitting. */
  by: "app" | "chat" | "user";
  /** Whether the chat is told the task was stopped, in a note written into it that starts no turn. */
  wakesChat: boolean;
}
