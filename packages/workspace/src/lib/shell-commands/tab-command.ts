import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and description of the chat's `instrument tab` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 */
export const TAB_COMMAND = {
  description: `The tabs of the user's window, each named by the id the note on their message gives it, pages, files, folders and screens alike: \`instrument tab open <url or path>...\` opens each in a tab of its own and shows it, printing the tab's id, which a task takes with --tab; \`instrument tab replace <id> <url or path>\` shows something else in a tab; \`instrument tab close <id>...\` closes tabs; \`instrument tab show <id>\` brings an open tab forward; \`instrument tab read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are. A path is a file or folder you can read. It opens nothing in the user's own applications and downloads nothing.`,
  name: `${INSTRUMENT_COMMAND.name} tab`,
  summary: "Open, show, read and close the tabs of the user's window.",
  word: "tab",
} as const;
