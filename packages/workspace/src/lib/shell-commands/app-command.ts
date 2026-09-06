/**
 * The name and one-line description of the `app` command, kept apart from the
 * command itself so prompt text and model notes can name it without importing
 * the workspace machinery the command runs against.
 */
export const APP_COMMAND = {
  description:
    "Reach the services connected to this workspace: look one up in the directory, write its folder, test it until it connects, then list and call its tools or make requests. `app help` prints the full surface.",
  name: "app",
} as const;
