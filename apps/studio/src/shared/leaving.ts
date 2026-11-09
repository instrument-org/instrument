/**
 * The IPC channels by which main asks a window to finish what it has put
 * off before the app quits, and the window says it has: `ask` carries a
 * token, and `done` sends the same token back once everything the window
 * had waiting has reached main.
 */
export const LEAVING_CHANNEL = {
  ask: "leaving:ask",
  done: "leaving:done",
} as const;
