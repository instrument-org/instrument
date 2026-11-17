import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument bookmarks` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const BOOKMARKS_COMMAND = {
  description:
    "The user's bookmarks: `instrument bookmarks list [words]` lists them by folder, on the bookmarks bar and in All Bookmarks; `add <url or path> [title]` keeps one in All Bookmarks, as the app's Add to Bookmarks does, which is the chat's alone.",
  name: `${INSTRUMENT_COMMAND.name} bookmarks`,
  summary: "The user's bookmarks: list them, and add one.",
  word: "bookmarks",
} as const;

/** Why a task's `instrument bookmarks add` does nothing: the chat changes them, from what the task reports. */
export const BOOKMARKS_ARE_THE_CHATS =
  "only the chat adds to the user's bookmarks. Say in your report what the chat should bookmark.";
