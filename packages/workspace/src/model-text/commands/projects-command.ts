import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument projects` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const PROJECTS_COMMAND = {
  description:
    "The user's projects, by name: what `instrument chats project` files a chat under.",
  name: `${INSTRUMENT_COMMAND.name} projects`,
  summary: "The user's projects, by name.",
  word: "projects",
} as const;
