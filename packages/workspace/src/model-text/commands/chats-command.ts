import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument chats` command, kept
 * apart from the command itself so prompt text can name it without importing
 * the workspace machinery the command runs against.
 */
export const CHATS_COMMAND = {
  description:
    "Organizing the user's chats, which is the chat's alone: `instrument chats list` names them, with which are working, waiting on the user or unread and each one's latest line (`--unread --waiting` lists what needs the user, `--working` what is running); `rename`, `archive`, `unarchive`, `project`, `mark-read` and `mark-unread` change them, by id (`mark-read --all` for every unread one), and `stop` ends the turns of other chats the user asked to stop. A chat is bookmarked with `instrument bookmarks add instrument://chat/<id> <title>`, which puts a star on its row.",
  name: `${INSTRUMENT_COMMAND.name} chats`,
  summary:
    "Organizing the user's chats: which need them, and rename, archive, file, mark read or stop them.",
  word: "chats",
} as const;

/** Why a task's `instrument chats` does nothing: the chat organizes, from what the task reports. */
export const CHATS_ARE_THE_CHATS =
  "only the chat organizes the user's chats. Say in your report what the chat should rename, archive, file, bookmark, mark read or stop.";
