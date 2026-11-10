import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and one-line description of the `instrument projects` command,
 * kept apart from the command itself so prompt text can name it without
 * importing the workspace machinery the command runs against.
 */
export const PROJECTS_COMMAND = {
  description:
    "The user's projects, what `instrument chats project` files a chat under: `instrument projects list` names them with their icon and color; `set` renames one or changes its icon, emoji, color or about line, `icons` finds an icon, and `retire` and `unretire` take one out of the menus or back.",
  name: `${INSTRUMENT_COMMAND.name} projects`,
  summary: "The user's projects: list them, and rename, mark or retire them.",
  word: "projects",
} as const;

/** Why a task's `instrument projects set` does nothing: the chat changes them, from what the task reports. */
export const PROJECTS_ARE_THE_CHATS =
  "only the chat changes the user's projects. Say in your report what the chat should rename, mark or retire.";
