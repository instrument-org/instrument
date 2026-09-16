/**
 * The name and one-line description of the orchestrator's `chat` command, kept
 * apart from the command itself so prompt text can name it without importing
 * the workspace machinery the command runs against.
 */
export const CHAT_COMMAND = {
  description:
    "Read the user's other threads: `chat threads [--topic <name>] [-n <count>]` lists them with where each stands, `chat read <id or title words> [--tail <n>]` reads the end of one, `chat search <words>` finds a line across all of them, `chat topics` names the topics, `chat tag <thread> <topic>` files a thread under one. The thread you are in is in front of you; these are for the others.",
  name: "chat",
} as const;
