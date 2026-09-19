/**
 * The name and one-line description of the orchestrator's `memory` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const MEMORY_COMMAND = {
  description:
    "What you keep about the user for every thread: `memory list` names it all, `memory save <name>` keeps or corrects one (the text on stdin through a quoted heredoc), `memory show <name>` reads one whole, `memory forget <name>` drops it.",
  name: "memory",
} as const;
