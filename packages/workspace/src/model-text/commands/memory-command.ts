import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument memory` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const MEMORY_COMMAND = {
  description:
    "What you keep about the user for every chat: `instrument memory list` names it all, `instrument memory show <name>` reads one whole. Keeping is the chat's: `instrument memory save <name>` keeps or corrects one (the text on stdin through a quoted heredoc), `instrument memory forget <name>` drops it.",
  name: `${INSTRUMENT_COMMAND.name} memory`,
  summary: "What you keep about the user for every chat.",
  word: "memory",
} as const;
