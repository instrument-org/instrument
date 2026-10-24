import { INSTRUMENT_COMMAND } from "./instrument-command";

/**
 * The name and description of the chat's `instrument tab` command, kept apart
 * from the command itself so prompt text can name it without importing the
 * workspace machinery the command runs against.
 */
export const TAB_COMMAND = {
  description: `This chat's tabs in the user's window, pages, files, folders and screens alike, each by its tab_ id: \`instrument tab list\` names them; \`instrument tab open <url or path>...\` opens each in a tab of its own and shows it, printing the tab's id, which a task takes with --tab; \`instrument tab replace <id> <url or path>\` shows something else in a tab; \`instrument tab close <id>...\` closes tabs; \`instrument tab show <id>\` brings an open tab forward; \`instrument tab read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are; \`instrument tab request <id> --reason '<one sentence to the user>'\` asks the user to move a tab of their own, which the note on their message named outside this chat, into it: a card shows them your reason with Move tab here and Skip, your turn ends, and their answer wakes you. A path is a file or folder you can read. It opens nothing in the user's own applications and downloads nothing.`,
  name: `${INSTRUMENT_COMMAND.name} tab`,
  summary:
    "List, open, show, read and close this chat's tabs, or ask for one of the user's.",
  word: "tab",
} as const;
