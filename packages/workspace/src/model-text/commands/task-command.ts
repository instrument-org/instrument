import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the chat's `instrument task` command, kept
 * apart from the command itself so prompt text and model notes can name it
 * without importing the workspace machinery the command runs against.
 */
export const TASK_COMMAND = {
  description:
    "Start, message, stop and read your tasks: you, carrying on in the background with this conversation in hand. `instrument task help` prints the full surface.",
  name: `${INSTRUMENT_COMMAND.name} task`,
  summary: "Start, message, stop and read your tasks.",
  word: "task",
} as const;
