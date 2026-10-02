/**
 * The name and one-line description of the orchestrator's `task` command, kept
 * apart from the command itself so prompt text and model notes can name it
 * without importing the workspace machinery the command runs against.
 */
export const TASK_COMMAND = {
  description:
    "Create, message, stop, list, inspect and read the tasks that do the work. `task help` prints the full surface.",
  name: "task",
} as const;
