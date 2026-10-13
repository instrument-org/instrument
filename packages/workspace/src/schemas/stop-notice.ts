/**
 * Who stopped a session's turn, and whether its chat hears about it. Carried
 * on the stop and out again on `session.done`, so the turn the stop ended is
 * the one it describes.
 */
export interface StopNotice {
  by: "chat" | "user";
  /** Whether the chat is woken with the stopped task's news. */
  wakesChat: boolean;
}
