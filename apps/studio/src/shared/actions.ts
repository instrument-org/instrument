/**
 * The one-way IPC channel a window tells the main process on what the person
 * did that only the window sees, for the action log. Sent rather than over
 * oRPC, whose every call is also a breadcrumb. The main process checks each
 * one against the log's schema before recording it
 * (`electron-main/lib/actions.ts`).
 */
export const RECORD_ACTION_CHANNEL = "record-action";

/**
 * The kinds of action a window may report: the screen in front once it
 * settles, and the errors it showed. Every other kind is recorded where it
 * happens, in the main process, and one a window sends is ignored.
 */
export const WINDOW_ACTION_KINDS = [
  "chat",
  "error",
  "file",
  "folder",
  "screen",
] as const;

export type WindowActionKind = (typeof WINDOW_ACTION_KINDS)[number];
