import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument settings` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const SETTINGS_COMMAND = {
  description:
    "Instrument's own settings (theme, zoom, notifications, dictation, suggestions, ad blocking and more): `instrument settings list` says what each is, its value and what it takes; `set <id> <value>` changes one the user asked to change, which is the chat's alone.",
  name: `${INSTRUMENT_COMMAND.name} settings`,
  summary: "Instrument's own settings: read them, and change them.",
  word: "settings",
} as const;

/** Why a task's `instrument settings set` does nothing: the chat changes them, from what the task reports. */
export const SETTINGS_ARE_THE_CHATS =
  "only the chat changes the user's settings. Say in your report what the chat should change.";
