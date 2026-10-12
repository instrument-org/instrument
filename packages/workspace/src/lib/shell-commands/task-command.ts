/**
 * The name and one-line description of the chat's `task` command, kept
 * apart from the command itself so prompt text and model notes can name it
 * without importing the workspace machinery the command runs against.
 */
export const TASK_COMMAND = {
  description:
    "Start, message, stop and read your tasks: you, carrying on in the background with this conversation in hand. `task help` prints the full surface.",
  name: "task",
} as const;
