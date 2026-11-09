import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument chats` command, kept
 * apart from the command itself so prompt text can name it without importing
 * the workspace machinery the command runs against.
 */
export const CHATS_COMMAND = {
  description:
    "Organizing the user's chats, which is the chat's alone: `instrument chats list` names them; `rename`, `archive`, `unarchive`, `project`, `star` and `unstar` change them, by id.",
  name: `${INSTRUMENT_COMMAND.name} chats`,
  summary: "Organizing the user's chats: rename, archive, file and star them.",
  word: "chats",
} as const;

/** Why a task's `instrument chats` does nothing: the chat organizes, from what the task reports. */
export const CHATS_ARE_THE_CHATS =
  "only the chat organizes the user's chats. Say in your report what the chat should rename, archive, file or star.";
