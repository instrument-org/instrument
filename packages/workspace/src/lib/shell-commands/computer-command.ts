import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument computer` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const COMPUTER_COMMAND = {
  description:
    "Operates the apps on this computer through what they show on screen, each with the person's yes. A last resort: a file the app reads, a command line tool, an app in Apps or `agent-browser` come first.",
  name: `${INSTRUMENT_COMMAND.name} computer`,
  summary: "Operate the apps on this computer, each with the person's yes.",
  word: "computer",
} as const;
