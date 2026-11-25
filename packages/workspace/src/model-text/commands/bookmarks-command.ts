import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument bookmarks` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const BOOKMARKS_COMMAND = {
  description:
    "The user's bookmarks: `instrument bookmarks list [words]` lists them by folder with their ids, on the bookmarks bar and in All Bookmarks. The chat alone changes them: `add <url or path> [title]` keeps one in All Bookmarks, as the app's Add to Bookmarks does; `move <id>... --to <bar|all|folder>` (or `--before <id>`/`--after <id>`), `rename <id> <name>`, `address <id> <url or path>`, `new-folder <name> [--in bar|all]`, and `remove <id>...`, a folder with what is in it. A card under the reply shows what changed, with Undo.",
  name: `${INSTRUMENT_COMMAND.name} bookmarks`,
  summary: "The user's bookmarks: list, add, move, rename and remove them.",
  word: "bookmarks",
} as const;

/** Why a task's change to the bookmarks does nothing: the chat changes them, from what the task reports. */
export const BOOKMARKS_ARE_THE_CHATS =
  "only the chat changes the user's bookmarks. Say in your report what the chat should change.";

/** Why a change made outside a reply, by a program still running after one, does nothing: no card would show it. */
export const BOOKMARKS_NEED_A_TURN =
  "bookmarks change only while you are working on a reply, whose card shows the change with Undo. Nothing changed. Run it again in this turn.";
