import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line summary of the chat's `instrument import` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const IMPORT_COMMAND = {
  name: `${INSTRUMENT_COMMAND.name} import`,
  summary: "Bring in the user's chats from other AI apps.",
  word: "import",
} as const;
