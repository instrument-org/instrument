import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line summary of the `instrument activity` command, kept
 * apart from the command itself so prompt and note text can name it without
 * importing the workspace machinery the command runs against.
 */
export const ACTIVITY_COMMAND = {
  name: `${INSTRUMENT_COMMAND.name} activity`,
  summary: "What the user did in this app lately, with names and paths.",
  word: "activity",
} as const;
