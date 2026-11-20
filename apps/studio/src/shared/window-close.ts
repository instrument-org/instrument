/**
 * The IPC channels by which main asks a window whether it may close, before
 * a close the person asked for: `ask` carries a token, and `answer` sends it
 * back with the window's answer. `asking` says the window has put a question
 * to the person, so main waits on it rather than on its deadline; `close` and
 * `stay` settle it.
 */
export const WINDOW_CLOSE_CHANNEL = {
  answer: "window-close:answer",
  ask: "window-close:ask",
} as const;

export type WindowCloseAnswer = "asking" | "close" | "stay";
